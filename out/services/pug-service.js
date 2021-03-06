"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const vscode_1 = require("vscode");
const lex = require('pug-lexer');
class PugService {
    constructor() {
        this._lexCache = {};
        vscode_1.workspace.onDidSaveTextDocument(document => {
            if (this._lexCache[document.fileName]) {
                this._parse(document);
            }
        });
    }
    _parse(document, cacheLife = 60 * 5) {
        return __awaiter(this, void 0, void 0, function* () {
            return new Promise(resolve => {
                const tokens = lex(document.getText());
                const fileName = document.fileName;
                resolve(tokens);
                this._lexCache[fileName] = tokens;
                setTimeout(() => delete this._lexCache[fileName], 1000 * cacheLife);
            });
        });
    }
    parse(document) {
        return __awaiter(this, void 0, void 0, function* () {
            if (this._lexCache[document.fileName]) {
                return Promise.resolve(this._lexCache[document.fileName]);
            }
            else {
                return this._parse(document, document.isDirty ? 5 : 60 * 5);
            }
        });
    }
    getToken(document, position) {
        return __awaiter(this, void 0, void 0, function* () {
            const tokens = yield this.parse(document);
            let result = null;
            for (let token of tokens) {
                if (token.loc.start.line >= position.line + 1 && token.loc.end.line <= position.line + 1 &&
                    token.loc.start.column <= position.character + 1 && token.loc.end.column >= position.character + 1) {
                    result = token;
                    break;
                }
            }
            return result;
        });
    }
    getSelector(document, token) {
        return __awaiter(this, void 0, void 0, function* () {
            let result = {
                tag: null,
                attribute: null
            };
            const tokens = yield this.parse(document);
            let tagIndex = tokens.indexOf(token);
            let attributeIndex = tagIndex;
            do {
                if (tokens[tagIndex].type === 'attribute' && tokens[tagIndex].val === true &&
                    tokens[tagIndex].name !== undefined && !/\[|\]|\(|\)|\*|\#|\@/.test(tokens[tagIndex].name)) {
                    result.attribute = tokens[tagIndex].name;
                }
            } while (--tagIndex > 0 && (tokens[tagIndex].type === 'attribute' || tokens[tagIndex].type === 'start-attributes' ||
                tokens[tagIndex].type === 'class' || tokens[tagIndex].type === 'id'));
            do {
                if (tokens[attributeIndex].type === 'attribute' && tokens[attributeIndex].val === true &&
                    tokens[attributeIndex].name !== undefined && !/\[|\]|\(|\)|\*|\#|\@/.test(tokens[attributeIndex].name)) {
                    result.attribute = tokens[attributeIndex].name;
                }
            } while (++attributeIndex < tokens.length && tokens[attributeIndex].type === 'attribute');
            if (tagIndex >= 0 && tokens[tagIndex].type === 'tag' && typeof tokens[tagIndex].val === 'string') {
                result.tag = tokens[tagIndex].val;
            }
            return result;
        });
    }
}
exports.PugService = PugService;
//# sourceMappingURL=pug-service.js.map