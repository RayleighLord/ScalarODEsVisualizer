import type { AxisBounds, CurvePoint, PlotLayout } from "../types";

export interface CoordinateSystem {
  innerLeft: number;
  innerTop: number;
  innerWidth: number;
  innerHeight: number;
  scaleX: number;
  scaleY: number;
  modelToSvg: (point: CurvePoint) => { x: number; y: number };
  svgToModel: (point: { x: number; y: number }) => CurvePoint;
  containsSvgPoint: (point: { x: number; y: number }) => boolean;
}

export function createCoordinateSystem(
  layout: PlotLayout,
  bounds: AxisBounds
): CoordinateSystem {
  const innerLeft = layout.padding.left;
  const innerTop = layout.padding.top;
  const innerWidth = layout.width - layout.padding.left - layout.padding.right;
  const innerHeight = layout.height - layout.padding.top - layout.padding.bottom;
  const scaleX = innerWidth / (bounds.tMax - bounds.tMin);
  const scaleY = innerHeight / (bounds.yMax - bounds.yMin);

  return {
    innerLeft,
    innerTop,
    innerWidth,
    innerHeight,
    scaleX,
    scaleY,
    modelToSvg(point) {
      return {
        x: innerLeft + (point.t - bounds.tMin) * scaleX,
        y: innerTop + (bounds.yMax - point.y) * scaleY
      };
    },
    svgToModel(point) {
      return {
        t: bounds.tMin + (point.x - innerLeft) / scaleX,
        y: bounds.yMax - (point.y - innerTop) / scaleY
      };
    },
    containsSvgPoint(point) {
      return (
        point.x >= innerLeft &&
        point.x <= innerLeft + innerWidth &&
        point.y >= innerTop &&
        point.y <= innerTop + innerHeight
      );
    }
  };
}
