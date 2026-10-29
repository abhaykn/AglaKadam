import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

const VIEW_WIDTH = 460;
const VIEW_HEIGHT = 350;
const CENTER_X = VIEW_WIDTH / 2;
const CENTER_Y = 184;
const RING_RADIUS = 116;
const NODE_RADIUS = 28;
/** Distance from a node's edge to its label, measured outwards from the centre of the ring. */
const LABEL_GAP = 12;
/** Angular clearance between an arrow and a node: node half-width plus a small gap. */
const ARC_CLEARANCE_DEG = (Math.asin(NODE_RADIUS / RING_RADIUS) * 180) / Math.PI + 4;

const stepKeys = ['pulse', 'plan', 'observe', 'coach', 'followUp'] as const;
/** Five evenly spaced positions, starting at the top and running clockwise. */
const nodeAngles = [-90, -18, 54, 126, 198];

interface Point {
  x: number;
  y: number;
}

function polar(angleDeg: number, radius: number): Point {
  const radians = (angleDeg * Math.PI) / 180;
  return {
    x: CENTER_X + radius * Math.cos(radians),
    y: CENTER_Y + radius * Math.sin(radians),
  };
}

function arcPath(fromDeg: number, toDeg: number): string {
  const start = polar(fromDeg + ARC_CLEARANCE_DEG, RING_RADIUS);
  const end = polar(toDeg - ARC_CLEARANCE_DEG, RING_RADIUS);
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${RING_RADIUS} ${RING_RADIUS} 0 0 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

/**
 * Places a label just outside its node, on the line from the centre of the ring, so that labels
 * never sit on top of the connecting arrows whatever the language or text length.
 */
function labelPlacement(angleDeg: number): {
  point: Point;
  anchor: 'start' | 'middle' | 'end';
  dy: string;
} {
  const radians = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const point = polar(angleDeg, RING_RADIUS + NODE_RADIUS + LABEL_GAP);
  const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle';
  const dy = sin < -0.6 ? '0' : sin > 0.6 ? '0.85em' : '0.35em';
  return { point, anchor, dy };
}

/** Diagram of the five-step mentoring loop, drawn from the same translations as the page text. */
export function LoopDiagram({ activeIndex }: { activeIndex?: number }) {
  const { t } = useTranslation();

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      role="img"
      aria-label={t('landing.loop.diagramLabel')}
      className="h-auto w-full"
    >
      <defs>
        <marker
          id="loop-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 1 L9 5 L0 9 Z" className="fill-primary" />
        </marker>
        <marker
          id="loop-arrow-accent"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 1 L9 5 L0 9 Z" className="fill-accent" />
        </marker>
      </defs>

      <circle
        cx={CENTER_X}
        cy={CENTER_Y}
        r={RING_RADIUS}
        className="fill-none stroke-border"
        strokeWidth="1"
        strokeDasharray="2 6"
      />

      {nodeAngles.map((angle, index) => {
        const isClosingArc = index === nodeAngles.length - 1;
        const nextAngle = isClosingArc ? (nodeAngles[0] ?? 0) + 360 : (nodeAngles[index + 1] ?? 0);
        return (
          <path
            key={`arc-${angle}`}
            d={arcPath(angle, nextAngle)}
            className={isClosingArc ? 'fill-none stroke-accent' : 'fill-none stroke-primary'}
            strokeWidth={isClosingArc ? 2.5 : 2}
            strokeLinecap="round"
            markerEnd={isClosingArc ? 'url(#loop-arrow-accent)' : 'url(#loop-arrow)'}
          />
        );
      })}

      <g transform={`translate(${CENTER_X - 28} ${CENTER_Y - 28}) scale(1.4)`} aria-hidden="true">
        <rect width="40" height="40" rx="10" fill="#4BA8D8" />
        <path
          d="M9 29V23.5H16V17.5H23V11.5H31V29Z"
          fill="#04293F"
          stroke="#04293F"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <circle cx="18.9" cy="12.2" r="2.6" fill="#FFD27A" />
      </g>

      {stepKeys.map((key, index) => {
        const angle = nodeAngles[index] ?? 0;
        const node = polar(angle, RING_RADIUS);
        const label = labelPlacement(angle);
        const isActive = index === activeIndex;
        return (
          <g key={key}>
            <circle
              cx={node.x}
              cy={node.y}
              r={NODE_RADIUS}
              className={cn(
                'stroke-primary transition-[fill] duration-500',
                isActive ? 'fill-primary' : 'fill-surface',
              )}
              strokeWidth="2"
            />
            <text
              x={node.x}
              y={node.y}
              dy="0.35em"
              textAnchor="middle"
              className={cn(
                'text-[20px] font-bold transition-[fill] duration-500',
                isActive ? 'fill-primary-fg' : 'fill-primary',
              )}
            >
              {index + 1}
            </text>
            <text
              x={label.point.x}
              y={label.point.y}
              dy={label.dy}
              textAnchor={label.anchor}
              className="fill-fg text-[17px] font-semibold"
            >
              {t(`landing.loop.steps.${key}.title`)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
