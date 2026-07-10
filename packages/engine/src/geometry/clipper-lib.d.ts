/**
 * Minimal ambient type declarations for the `clipper-lib` package (the JS port
 * of Angus Johnson's integer Clipper). Only the surface the engine uses is typed.
 */
declare module 'clipper-lib' {
  export interface IntPoint {
    X: number;
    Y: number;
  }
  export type Path = IntPoint[];
  export type Paths = Path[];

  export const ClipType: { ctIntersection: number; ctUnion: number; ctDifference: number; ctXor: number };
  export const PolyType: { ptSubject: number; ptClip: number };
  export const PolyFillType: { pftEvenOdd: number; pftNonZero: number; pftPositive: number; pftNegative: number };
  export const JoinType: { jtSquare: number; jtRound: number; jtMiter: number };
  export const EndType: {
    etOpenSquare: number;
    etOpenRound: number;
    etOpenButt: number;
    etClosedLine: number;
    etClosedPolygon: number;
  };

  export class PolyNode {
    Contour(): Path;
    Childs(): PolyNode[];
    IsHole(): boolean;
  }

  export class PolyTree extends PolyNode {
    Clear(): void;
  }

  export class Clipper {
    constructor(initOptions?: number);
    AddPath(path: Path, polyType: number, closed: boolean): boolean;
    AddPaths(paths: Paths, polyType: number, closed: boolean): boolean;
    Execute(clipType: number, solution: PolyTree, subjFillType: number, clipFillType: number): boolean;
    Execute(clipType: number, solution: Paths, subjFillType: number, clipFillType: number): boolean;
    static MinkowskiSum(pattern: Path, path: Path, pathIsClosed: boolean): Paths;
    static Area(path: Path): number;
    static Orientation(path: Path): boolean;
    static CleanPolygons(paths: Paths, distance: number): Paths;
    static ReversePath(path: Path): void;
  }

  export class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number);
    AddPath(path: Path, joinType: number, endType: number): void;
    AddPaths(paths: Paths, joinType: number, endType: number): void;
    Execute(solution: PolyTree | Paths, delta: number): void;
    Clear(): void;
  }
}
