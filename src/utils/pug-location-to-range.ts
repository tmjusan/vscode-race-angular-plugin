import { PugTokenLocation } from "../interfaces/pug-token";
import { Range, Position } from "vscode";

export function pugLocationToRange(loc: PugTokenLocation, length?: number): Range {
    return new Range(
        new Position(loc.start.line - 1, loc.start.column - 1),
        new Position(loc.end.line - 1, length ? length + loc.start.column - 1 : loc.end.column - 1)
    );
}