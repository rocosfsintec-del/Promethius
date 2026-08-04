import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function Markdown({ children }) {
  return (
    <div className="md-body" data-testid="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          pre: ({ children, ...props }) => <pre className="md-pre" {...props}>{children}</pre>,
          code: ({ className, children, ...props }) => {
            const isBlock = /language-/.test(className || "");
            return (
              <code className={isBlock ? className : "md-inline-code"} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {children || ""}
      </ReactMarkdown>
    </div>
  );
}
