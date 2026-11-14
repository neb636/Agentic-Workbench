import { useEffect, useRef } from "react";
import type { LocalPreviewConnection, LocalPreviewProps } from "@dimsum/sdk";
import { LOCAL_PREVIEW_CONNECT, LOCAL_PREVIEW_HELLO, localPreviewUrl } from "../../shared/local-preview";

/**
 * A page served on this machine, in a sandboxed frame. It keeps its own origin (so its storage and modules work) but has
 * no preload, no permissions and can't navigate the app; main also refuses any frame navigation off loopback.
 *
 * The page connects by posting `{ dimsum: "local-preview.hello" }` to its parent. The app answers with
 * `{ dimsum: "local-preview.connect" }` and a MessagePort, so the page never needs to know the app's origin, and
 * nothing the page sends reaches the app except through that port. Each hello replaces the previous connection.
 */
export function LocalPreview({ url, title, onConnect, onMessage, className, style }: LocalPreviewProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const handlers = useRef({ onConnect, onMessage });
  handlers.current = { onConnect, onMessage };
  const src = localPreviewUrl(url, window.location.origin)?.href;
  const shown = Boolean(src);

  // Keyed on the frame being there, not on its URL: a change of only the fragment navigates within the same document,
  // which never says hello again, so the connection must outlive it. A page that does load anew says hello itself.
  useEffect(() => {
    const element = frame.current;
    if (!shown || !element) return;
    let port: MessagePort | undefined;
    const hello = (event: MessageEvent) => {
      if (event.source !== element.contentWindow || (event.data as { dimsum?: unknown } | null)?.dimsum !== LOCAL_PREVIEW_HELLO) return;
      // The page's real origin, so the port can only be delivered to the document that asked for it.
      if (!localPreviewUrl(`${event.origin}/`, window.location.origin)) return;
      port?.close();
      const channel = new MessageChannel();
      const own = channel.port1;
      port = own;
      own.onmessage = (message) => { if (port === own) handlers.current.onMessage?.(message.data); };
      element.contentWindow?.postMessage({ dimsum: LOCAL_PREVIEW_CONNECT }, event.origin, [channel.port2]);
      const connection: LocalPreviewConnection = { post: (data) => { if (port === own) own.postMessage(data); } };
      handlers.current.onConnect?.(connection);
    };
    window.addEventListener("message", hello);
    return () => {
      window.removeEventListener("message", hello);
      port?.close();
      port = undefined;
    };
  }, [shown]);

  if (!src) {
    return <div role="alert" className={["wb-local-preview-refused", className].filter(Boolean).join(" ")} style={style}>
      Only pages served on this machine (http or https on 127.0.0.1 or localhost) can be shown here, not {url}.
    </div>;
  }
  return <iframe
    ref={frame}
    src={src}
    title={title}
    className={["wb-local-preview", className].filter(Boolean).join(" ")}
    style={style}
    // Scripts and its own origin, nothing else: no popups, no top navigation, no downloads, no permissions.
    sandbox="allow-scripts allow-same-origin allow-forms allow-pointer-lock"
    referrerPolicy="no-referrer"
  />;
}
