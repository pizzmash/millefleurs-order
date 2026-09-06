import { Martini } from 'lucide-react';
import type QRCode from 'qrcode';

// The header and invitation share the same brand symbol.
export function BrandIcon({ size = 22 }: { size?: number }) {
  return <Martini size={size} strokeWidth={1.3} aria-hidden="true" />;
}

export function InviteQr({ code }: { code: QRCode.QRCode }) {
  const { modules } = code;
  const size = modules.size;
  const margin = 4;
  const extent = size + margin * 2;
  const finders = [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ];
  const dark = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && !!modules.get(y, x);
  // One filled path avoids antialiasing seams between neighboring cells.
  // Round only exposed corners; shared edges keep their full width.
  const cells = Array.from({ length: size * size }, (_, index) => {
    const x = index % size;
    const y = Math.floor(index / size);
    if (!dark(x, y) || finders.some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7))
      return '';
    const top = dark(x, y - 1);
    const right = dark(x + 1, y);
    const bottom = dark(x, y + 1);
    const left = dark(x - 1, y);
    const tl = !top && !left ? 0.25 : 0;
    const tr = !top && !right ? 0.25 : 0;
    const br = !bottom && !right ? 0.25 : 0;
    const bl = !bottom && !left ? 0.25 : 0;
    return `M${x + tl} ${y}H${x + 1 - tr}Q${x + 1} ${y} ${x + 1} ${y + tr}V${y + 1 - br}Q${x + 1} ${y + 1} ${x + 1 - br} ${y + 1}H${x + bl}Q${x} ${y + 1} ${x} ${y + 1 - bl}V${y + tl}Q${x} ${y} ${x + tl} ${y}Z`;
  }).join('');
  // Keep the logo small (five modules) even for long URLs.
  const badge = 5;
  const center = extent / 2;
  return (
    <svg
      className="invite-qr"
      viewBox={`0 0 ${extent} ${extent}`}
      width="280"
      height="280"
      role="img"
      aria-label="客人の参加用QRコード"
    >
      <rect width={extent} height={extent} fill="#faf6ec" />
      <g transform={`translate(${margin} ${margin})`} fill="#263e35">
        <path d={cells} />
        {finders.map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <rect x={x} y={y} width="7" height="7" rx="1.3" />
            <rect x={x + 1} y={y + 1} width="5" height="5" rx="0.8" fill="#faf6ec" />
            <rect x={x + 2} y={y + 2} width="3" height="3" rx="0.6" />
          </g>
        ))}
      </g>
      <rect
        x={center - badge / 2}
        y={center - badge / 2}
        width={badge}
        height={badge}
        rx="1"
        fill="#faf6ec"
      />
      <rect x={center - 2} y={center - 2} width="4" height="4" rx="0.8" fill="#263e35" />
      <g transform={`translate(${center - 1.5} ${center - 1.5})`} color="#d9b97a">
        <BrandIcon size={3} />
      </g>
    </svg>
  );
}
