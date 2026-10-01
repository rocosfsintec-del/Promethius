"""
PDF toolkit for Promethius.

Loud-fail contract: every error surfaces a clear reason.
No silent empty strings.
"""
import os
import io
import logging
import shutil
from io import BytesIO
from typing import Optional, List, Tuple

logger = logging.getLogger("promethius.pdf")

# Loud limits — tune if needed
MAX_PDF_BYTES = 25 * 1024 * 1024  # 25 MB
MAX_PDF_PAGES = 500
OCR_MIN_TEXT_CHARS = 50  # Below this, try OCR fallback


class PdfToolError(Exception):
    """Raised on any PDF operation failure. Carries http_status for API surfacing."""
    def __init__(self, reason: str, http_status: int = 422):
        super().__init__(reason)
        self.reason = reason
        self.http_status = http_status


# --- Tesseract autodetect (Windows-friendly) --------------------------------
_OCR_AVAILABLE = False


def _autodetect_tesseract() -> bool:
    """Locate the Tesseract binary. Sets pytesseract.tesseract_cmd if found.
    Returns True if OCR is available, False otherwise (logs loud warning)."""
    global _OCR_AVAILABLE
    if shutil.which("tesseract"):
        _OCR_AVAILABLE = True
        return True
    candidates = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"),
        "/usr/bin/tesseract",
        "/usr/local/bin/tesseract",
        "/opt/homebrew/bin/tesseract",
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            try:
                import pytesseract
                pytesseract.pytesseract.tesseract_cmd = path
                _OCR_AVAILABLE = True
                logger.info(f"[pdf] Tesseract autodetected at {path}")
                return True
            except Exception as e:
                logger.warning(f"[pdf] Tesseract found at {path} but pytesseract import failed: {e}")
    logger.warning(
        "[pdf] Tesseract binary not found. OCR will be unavailable. "
        "Install from https://github.com/UB-Mannheim/tesseract/wiki or add to PATH."
    )
    _OCR_AVAILABLE = False
    return False


_autodetect_tesseract()


def ocr_available() -> bool:
    return _OCR_AVAILABLE


# --- Metadata ---------------------------------------------------------------
def pdf_metadata(data: bytes) -> dict:
    """Return metadata about a PDF: pages, author, title, encrypted, has_forms, size_bytes.
    Raises PdfToolError on unreadable input."""
    if not data:
        raise PdfToolError("Empty PDF data.", 422)
    if len(data) > MAX_PDF_BYTES:
        raise PdfToolError(
            f"PDF is too large ({len(data)} bytes). Max allowed: {MAX_PDF_BYTES} bytes.",
            413
        )
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(BytesIO(data))
    except Exception as e:
        raise PdfToolError(f"Could not open PDF: {e}", 422)

    encrypted = bool(getattr(reader, "is_encrypted", False))
    pages = 0
    author = ""
    title = ""
    has_forms = False

    if not encrypted:
        try:
            pages = len(reader.pages)
        except Exception:
            pages = 0
        try:
            info = reader.metadata or {}
            author = str(info.get("/Author", "") or "")
            title = str(info.get("/Title", "") or "")
        except Exception:
            pass
        try:
            root = reader.trailer.get("/Root", {}) if hasattr(reader, "trailer") else {}
            acroform = root.get("/AcroForm") if hasattr(root, "get") else None
            has_forms = acroform is not None
        except Exception:
            has_forms = False

    if pages > MAX_PDF_PAGES and not encrypted:
        raise PdfToolError(
            f"PDF has {pages} pages (max allowed: {MAX_PDF_PAGES}).",
            413
        )

    return {
        "pages": pages,
        "author": author[:200],
        "title": title[:200],
        "encrypted": encrypted,
        "has_forms": has_forms,
        "size_bytes": len(data),
        "ocr_available": _OCR_AVAILABLE,
    }


# --- Text extraction --------------------------------------------------------
def _extract_with_pdfplumber(data: bytes) -> str:
    try:
        import pdfplumber
        parts = []
        with pdfplumber.open(BytesIO(data)) as pdf:
            for page in pdf.pages:
                t = page.extract_text() or ""
                if t.strip():
                    parts.append(t)
        return "\n\n".join(parts)
    except Exception as e:
        logger.info(f"[pdf] pdfplumber failed, will try PyPDF2: {e}")
        return ""


def _extract_with_pypdf2(data: bytes) -> str:
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(BytesIO(data))
        parts = []
        for page in reader.pages:
            t = page.extract_text() or ""
            if t.strip():
                parts.append(t)
        return "\n\n".join(parts)
    except Exception as e:
        logger.info(f"[pdf] PyPDF2 failed: {e}")
        return ""


def _extract_with_ocr(data: bytes) -> str:
    """OCR fallback using pytesseract + pypdfium2 to rasterize pages."""
    if not _OCR_AVAILABLE:
        logger.warning("[pdf] OCR requested but Tesseract not available; returning empty.")
        return ""
    try:
        import pytesseract
        import pypdfium2 as pdfium
        pdf = pdfium.PdfDocument(data)
        parts = []
        # Cap OCR at 50 pages to prevent runaway compute
        for i in range(min(len(pdf), 50)):
            page = pdf[i]
            pil = page.render(scale=2).to_pil()
            txt = pytesseract.image_to_string(pil) or ""
            if txt.strip():
                parts.append(txt)
        return "\n\n".join(parts)
    except Exception as e:
        logger.error(f"[pdf] OCR failed: {e}")
        return ""


def extract_pdf_text(data: bytes, ocr: bool = True) -> Tuple[str, dict]:
    """Extract text from PDF bytes. Returns (text, info_dict).
    info_dict includes: method_used, ocr_available, chars_extracted.
    Raises PdfToolError on encrypted / oversized / unreadable input.
    Returns empty string with method_used='none' if truly no text extractable —
    caller should surface this loudly, never silently."""
    meta = pdf_metadata(data)  # raises if oversized / bad
    if meta["encrypted"]:
        raise PdfToolError(
            "PDF is password-protected. Unlock it or provide the password first.",
            422
        )

    text = _extract_with_pdfplumber(data)
    method = "pdfplumber"

    if len(text.strip()) < OCR_MIN_TEXT_CHARS:
        text2 = _extract_with_pypdf2(data)
        if len(text2.strip()) > len(text.strip()):
            text = text2
            method = "pypdf2"

    if ocr and len(text.strip()) < OCR_MIN_TEXT_CHARS:
        if _OCR_AVAILABLE:
            ocr_text = _extract_with_ocr(data)
            if len(ocr_text.strip()) > len(text.strip()):
                text = ocr_text
                method = "ocr"
        else:
            method = f"{method}+ocr_unavailable"

    info = {
        "method_used": method,
        "ocr_available": _OCR_AVAILABLE,
        "chars_extracted": len(text),
        "pages": meta["pages"],
        "has_forms": meta["has_forms"],
    }
    return text, info


# --- Generation -------------------------------------------------------------
def generate_pdf_from_markdown(md_text: str, title: Optional[str] = None) -> bytes:
    """Convert simple markdown-ish text to a PDF. Returns raw PDF bytes.
    Not a full markdown renderer — handles headings (# ## ###), bullets (- *),
    numbered lists, and paragraphs. Loud fail if reportlab is missing."""
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, PageBreak
        )
        from reportlab.lib.enums import TA_LEFT
    except Exception as e:
        raise PdfToolError(f"reportlab not available: {e}", 500)

    if not md_text or not md_text.strip():
        raise PdfToolError("Cannot generate PDF from empty text.", 400)

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter,
        leftMargin=0.75 * inch, rightMargin=0.75 * inch,
        topMargin=0.75 * inch, bottomMargin=0.75 * inch,
        title=(title or "Promethius Document")[:120],
    )
    styles = getSampleStyleSheet()
    story = []

    if title:
        story.append(Paragraph(_esc(title[:200]), styles["Title"]))
        story.append(Spacer(1, 0.2 * inch))

    for raw_line in md_text.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            story.append(Spacer(1, 0.1 * inch))
            continue
        if line.startswith("### "):
            story.append(Paragraph(_esc(line[4:]), styles["Heading3"]))
        elif line.startswith("## "):
            story.append(Paragraph(_esc(line[3:]), styles["Heading2"]))
        elif line.startswith("# "):
            story.append(Paragraph(_esc(line[2:]), styles["Heading1"]))
        elif line.lstrip().startswith(("- ", "* ")):
            content = line.lstrip()[2:]
            story.append(Paragraph("• " + _esc(content), styles["BodyText"]))
        else:
            story.append(Paragraph(_esc(line), styles["BodyText"]))

    try:
        doc.build(story)
    except Exception as e:
        raise PdfToolError(f"PDF generation failed: {e}", 500)
    return buf.getvalue()


def _esc(s: str) -> str:
    """Escape for reportlab Paragraph (which parses a mini-HTML)."""
    return (s.replace("&", "&amp;")
             .replace("<", "&lt;")
             .replace(">", "&gt;"))


# --- Merge / split ----------------------------------------------------------
def merge_pdfs(pdf_bytes_list: List[bytes]) -> bytes:
    """Merge a list of PDF byte blobs into one. Raises PdfToolError on failure."""
    if not pdf_bytes_list:
        raise PdfToolError("No PDFs provided to merge.", 400)
    try:
        from PyPDF2 import PdfWriter, PdfReader
    except Exception as e:
        raise PdfToolError(f"PyPDF2 not available: {e}", 500)

    writer = PdfWriter()
    for i, data in enumerate(pdf_bytes_list):
        if len(data) > MAX_PDF_BYTES:
            raise PdfToolError(f"PDF #{i+1} exceeds size limit.", 413)
        try:
            reader = PdfReader(BytesIO(data))
            if getattr(reader, "is_encrypted", False):
                raise PdfToolError(f"PDF #{i+1} is encrypted; cannot merge.", 422)
            for page in reader.pages:
                writer.add_page(page)
        except PdfToolError:
            raise
        except Exception as e:
            raise PdfToolError(f"Could not read PDF #{i+1}: {e}", 422)

    out = BytesIO()
    writer.write(out)
    return out.getvalue()


def split_pdf(data: bytes, page_ranges: List[Tuple[int, int]]) -> List[bytes]:
    """Split a PDF by 1-indexed inclusive page ranges. Returns list of PDF blobs."""
    if not page_ranges:
        raise PdfToolError("No page ranges provided.", 400)
    try:
        from PyPDF2 import PdfWriter, PdfReader
    except Exception as e:
        raise PdfToolError(f"PyPDF2 not available: {e}", 500)

    try:
        reader = PdfReader(BytesIO(data))
    except Exception as e:
        raise PdfToolError(f"Could not read PDF: {e}", 422)

    if getattr(reader, "is_encrypted", False):
        raise PdfToolError("PDF is encrypted; cannot split.", 422)

    total = len(reader.pages)
    outputs = []
    for start, end in page_ranges:
        if start < 1 or end < start or end > total:
            raise PdfToolError(
                f"Invalid range {start}-{end} (PDF has {total} pages).", 400
            )
        writer = PdfWriter()
        for pnum in range(start - 1, end):
            writer.add_page(reader.pages[pnum])
        buf = BytesIO()
        writer.write(buf)
        outputs.append(buf.getvalue())
    return outputs