import { useEffect, useRef, useState } from "react";
import { MdImage, MdImageNotSupported, MdEdit } from "react-icons/md";
import { getPhotoImage } from "../../api/progress";
import type { PhotoHub, PhotoRow } from "../../api/progress";

/**
 * Meal-photo archive strip. Thumbnails load on demand via getPhotoImage —
 * the list payload never includes images. Macros shown are accepted only.
 */

const THUMB = 104;
const PREFETCH = 8;

function Thumb({ row }: { row: PhotoRow }) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current || !row.has_image) return;
    asked.current = true;
    let active = true;
    void getPhotoImage(row.id)
      .then((data) => active && setUri(data))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [row.id, row.has_image]);

  return (
    <div style={{ width: THUMB }} className="shrink-0">
      <div
        className="relative overflow-hidden rounded-lg bg-[#0F1115]"
        style={{ width: THUMB, height: THUMB }}
      >
        {uri ? (
          <img
            src={uri}
            alt={row.title || "Meal"}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {failed || !row.has_image ? (
              <MdImageNotSupported size={20} className="text-[#8E8E93]" />
            ) : (
              <MdImage size={20} className="text-[#8E8E93]" />
            )}
          </div>
        )}
        {row.was_corrected ? (
          <div className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#FF6B35]">
            <MdEdit size={9} className="text-white" />
          </div>
        ) : null}
      </div>
      <p className="mt-1 truncate text-[10px] font-medium text-white">
        {row.title || "Meal"}
      </p>
      <p className="text-[10px] text-[#8E8E93]">
        {row.logged?.calories != null
          ? `${Math.round(row.logged.calories)} kcal`
          : "not logged"}
      </p>
    </div>
  );
}

export default function PhotoStrip({ hub }: { hub: PhotoHub | null }) {
  if (!hub || hub.total === 0) return null;

  const rows = hub.photos.slice(0, PREFETCH);

  return (
    <section>
      <h2 className="mb-2 mt-8 text-[10px] font-bold tracking-[1.4px] text-[#8E8E93]">
        MEALS YOU PHOTOGRAPHED
      </h2>
      <div className="rounded-xl bg-[#161A22] p-4">
        <p className="mb-2 text-xs text-[#8E8E93]">
          {hub.in_range} in range · {hub.labelled} logged
          {hub.unlabelled ? ` · ${hub.unlabelled} never logged` : ""}
        </p>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {rows.map((row) => (
            <Thumb key={row.id} row={row} />
          ))}
        </div>

        <p className="mt-3 text-[10px] leading-4 text-[#8E8E93]">
          {hub.bias.measurable ? hub.bias.summary : hub.bias.reason}
        </p>
      </div>
    </section>
  );
}
