"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const path = require("path");
function getFullPathOrNull(document, relativePath) {
    return new Promise(resolve => {
        if (document !== null && document !== undefined &&
            relativePath !== null && relativePath !== undefined) {
            const fullPath = path.resolve(path.dirname(document.fileName), relativePath);
            if (fullPath !== null && fullPath !== undefined) {
                fs.open(fullPath, 'r', (error, fd) => {
                    if (error) {
                        resolve(null);
                    }
                    else {
                        fs.close(fd, error => {
                            resolve(fullPath);
                        });
                    }
                });
            }
            else {
                resolve(null);
            }
        }
        else {
            resolve(null);
        }
    });
}
exports.getFullPathOrNull = getFullPathOrNull;
//# sourceMappingURL=get-full-path-or-null.js.map