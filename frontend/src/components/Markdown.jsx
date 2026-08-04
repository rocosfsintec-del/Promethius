import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function Markdown({ children }) {
  return (
    <div className="md-body" data-testid="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          code: ({ inline, className, children, ...props }) =>
            inline ? (
              <code className="md-inline-code" {...props}>{children}</code>
            ) : (
              <pre className="md-pre"><code className={className} {...props}>{children}</code></pre>
            ),
        }}
      >
        {children || ""}
      </ReactMarkdown>
    </div>
  );
}
