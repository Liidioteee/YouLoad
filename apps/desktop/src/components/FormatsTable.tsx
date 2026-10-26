import { useState } from "react";
import { X } from "lucide-react";

import { bytes } from "@youload/shared/format";
import { codecOf, CODEC_LABEL, isAudio, isVideo, languageName } from "@youload/shared/formats";
import { useT } from "@youload/shared/i18n";
import type { DownloadOptions, Format, MediaInfo } from "@youload/shared/types";
import styles from "./FormatsTable.module.css";

/** Manual pick of the exact video stream and audio track. */
export function FormatsTable({ media, o, onApply, onClose }: { media: MediaInfo; o: DownloadOptions; onApply: (patch: Partial<DownloadOptions>) => void; onClose: () => void }) {
  const t = useT();
  const video = media.formats.filter(isVideo).sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.fps ?? 0) - (a.fps ?? 0) || (b.tbr ?? 0) - (a.tbr ?? 0));
  const audio = media.formats.filter(isAudio).sort((a, b) => (a.language ?? "").localeCompare(b.language ?? "") || (b.abr ?? 0) - (a.abr ?? 0));
  const [v, setV] = useState<string | null>(o.videoFormat ?? video[0]?.id ?? null);
  const [a, setA] = useState<string | null>(o.audioFormat ?? audio[0]?.id ?? null);
  const chosenVideo = video.find((f) => f.id === v);
  const muxed = chosenVideo?.kind === "muxed";

  const size = (f: Format) => (f.size ? `${f.sizeApprox ? "≈" : ""}${bytes(f.size, t)}` : "—");
  const kbps = (f: Format) => (f.tbr ? `${Math.round(f.tbr)}k` : "—");

  return (
    <div className="scrim" onClick={onClose}>
      <div className={`modal ${styles.modal}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label={t("formats.title")}>
        <div className="modal-head">
          <div>
            <h2>{t("formats.title")}</h2>
            <p>{t("formats.subtitle")}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <h3 className={styles.caption}>{t("formats.video")}</h3>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th />
                  <th>{t("formats.id")}</th>
                  <th>{t("formats.resolution")}</th>
                  <th>{t("formats.fps")}</th>
                  <th>{t("formats.codec")}</th>
                  <th>{t("formats.bitrate")}</th>
                  <th>{t("formats.size")}</th>
                  <th>{t("formats.note")}</th>
                </tr>
              </thead>
              <tbody>
                {video.map((f) => (
                  <tr key={f.id} className={v === f.id ? styles.on : ""} onClick={() => setV(f.id)}>
                    <td>
                      <input type="radio" name="fmt-video" checked={v === f.id} onChange={() => setV(f.id)} aria-label={f.id} />
                    </td>
                    <td className="mono">{f.id}</td>
                    <td className="mono">
                      {f.width}×{f.height}
                    </td>
                    <td className="mono">{f.fps ? Math.round(f.fps) : "—"}</td>
                    <td className="mono">{CODEC_LABEL[codecOf(f)!]}</td>
                    <td className="mono">{kbps(f)}</td>
                    <td className="mono">{size(f)}</td>
                    <td>
                      {f.hdr ? <span className={styles.hdr}>HDR</span> : null} {f.kind === "muxed" ? t("formats.muxed") : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className={styles.caption}>{t("formats.audio")}</h3>
          {muxed ? (
            <p className={styles.note}>{t("formats.noAudio")}</p>
          ) : (
            <div className={styles.scroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th />
                    <th>{t("formats.id")}</th>
                    <th>{t("formats.language")}</th>
                    <th>{t("formats.codec")}</th>
                    <th>{t("formats.bitrate")}</th>
                    <th>{t("formats.size")}</th>
                    <th>{t("formats.note")}</th>
                  </tr>
                </thead>
                <tbody>
                  {audio.map((f) => (
                    <tr key={f.id} className={a === f.id ? styles.on : ""} onClick={() => setA(f.id)}>
                      <td>
                        <input type="radio" name="fmt-audio" checked={a === f.id} onChange={() => setA(f.id)} aria-label={f.id} />
                      </td>
                      <td className="mono">{f.id}</td>
                      <td>{f.language ? languageName(f.language, t) : "—"}</td>
                      <td className="mono">{f.acodec?.split(".")[0]}</td>
                      <td className="mono">{f.abr ? `${Math.round(f.abr)}k` : kbps(f)}</td>
                      <td className="mono">{size(f)}</td>
                      <td>{f.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            className="btn primary"
            disabled={!v}
            onClick={() => {
              onApply({
                mode: "video",
                videoFormat: v,
                audioFormat: muxed ? null : a,
                videoCodec: chosenVideo ? codecOf(chosenVideo) : null,
                maxHeight: chosenVideo?.height ?? null,
                manualFormats: true,
              });
              onClose();
            }}
          >
            {t("common.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
