"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const get_file_location_or_null_1 = require("../utils/get-file-location-or-null");
class FileUrlDefinitionProvider {
    provideDefinition(document, position, token) {
        const wordRange = document.getWordRangeAtPosition(position, /(['"])((?:[^<>:;,?"*|\\\/]+)?[\\\/](?:[^<>:;,?"*|\\\/]+))+\1/g);
        let result;
        if (wordRange !== null && wordRange !== undefined) {
            let relativeUri = document.getText(wordRange);
            let match = /[^<>:;,?"*|]+/g.exec(relativeUri);
            if (match !== null) {
                relativeUri = match[0];
            }
            else {
                relativeUri = relativeUri.substring(1, relativeUri.length - 1);
            }
            result = get_file_location_or_null_1.getFileLocationOrNull(document, position, relativeUri);
        }
        else {
            result = null;
        }
        return result;
    }
}
exports.FileUrlDefinitionProvider = FileUrlDefinitionProvider;
//# sourceMappingURL=file-url-definition-provider-ts.js.map