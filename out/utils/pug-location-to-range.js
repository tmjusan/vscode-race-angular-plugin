"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_1 = require("vscode");
function pugLocationToRange(loc, length) {
    return new vscode_1.Range(new vscode_1.Position(loc.start.line - 1, loc.start.column - 1), new vscode_1.Position(loc.end.line - 1, length ? length + loc.start.column - 1 : loc.end.column - 1));
}
exports.pugLocationToRange = pugLocationToRange;
//# sourceMappingURL=pug-location-to-range.js.map