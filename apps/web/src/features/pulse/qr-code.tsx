import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** A QR code drawn as an SVG, dark on light whatever the theme, so every camera can read it. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const code = qrcode(0, 'M');
    code.addData(text);
    code.make();
    const count = code.getModuleCount();
    const cells: string[] = [];
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (code.isDark(row, column)) {
          // The quiet zone of four modules around the code is part of the drawing.
          cells.push(`M${String(column + 4)} ${String(row + 4)}h1v1h-1z`);
        }
      }
    }
    return { size: count + 8, path: cells.join('') };
  }, [text]);

  return (
    <svg
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      role="img"
      aria-label={label}
      className="w-full max-w-80"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
