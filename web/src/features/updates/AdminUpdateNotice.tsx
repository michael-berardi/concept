import { useEffect, useState } from "react";
import { api, type UpdateStatus } from "@/api";
import { Icon } from "@/ui/icons";
import { useSession } from "@/state/session";
import { markShown, noticeText, readPrefs, shouldShowUpdateNotice, skipVersion, writePrefs } from "./updateNotice";

/** Instance admins only: the server's cached daily release check. Docker installs never update themselves. */
export function AdminUpdateNotice() {
  const { me } = useSession();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!me?.isAdmin) return;
    let alive = true;
    api.updates().then((s) => {
      if (!alive) return;
      setStatus(s);
      if (!s.enabled) return writePrefs(null); // opted out: forget this browser's notice state
      const prefs = readPrefs();
      if (s.version && shouldShowUpdateNotice(s, prefs)) {
        writePrefs(markShown(prefs, s.version));
        setVisible(true);
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [me?.isAdmin]);

  const text = noticeText(status);
  if (!visible || !text || !status?.version) return null;
  const version = status.version;

  return (
    <div className="banner update-banner" role="status">
      <Icon name="arrowUpRight" size={16} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{text}</strong>
        {status.notes ? <div className="faint update-notes">{status.notes}</div> : null}
        <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>
          Update: <code className="mono">{status.command}</code>
          {status.releaseUrl ? (
            <>
              {" · "}
              <a href={status.releaseUrl} target="_blank" rel="noreferrer">Release notes</a>
            </>
          ) : null}
        </div>
      </div>
      <button className="btn sm" onClick={() => setVisible(false)}>Later</button>
      <button
        className="btn sm"
        onClick={() => {
          writePrefs(skipVersion(readPrefs(), version));
          setVisible(false);
        }}
      >
        Skip this version
      </button>
    </div>
  );
}
