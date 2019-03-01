import { workspace, TextDocument, Position } from "vscode";
import { PugToken, PugAttributeToken } from "../interfaces/pug-token";
import { FindSelectorResult } from "../interfaces/find-selector-result";

const lex = require('pug-lexer');

export class PugService {

    private _lexCache: {[path: string]: Array<PugToken>} = {};

    constructor() {
        workspace.onDidSaveTextDocument(document => {
            if (this._lexCache[document.fileName]) {
                this._parse(document);
            }
        });
    }

    private async _parse(document: TextDocument, cacheLife: number = 60 * 5): Promise<Array<PugToken>> {
        return new Promise<any>(resolve => {
            const tokens = lex(document.getText());
            const fileName = document.fileName;
            resolve(tokens);
            this._lexCache[fileName] = tokens;
            setTimeout(() => delete this._lexCache[fileName], 1000 * cacheLife);
        });
    }

    async parse(document: TextDocument): Promise<Array<PugToken>> {
        if (this._lexCache[document.fileName]) {
            return Promise.resolve(this._lexCache[document.fileName]);
        } else {
            return this._parse(document, document.isDirty ? 5 : 60 * 5);
        }
    }

    async getToken(document: TextDocument, position: Position): Promise<PugToken | null> {
        const tokens = await this.parse(document);
        let result: PugToken | null = null;
        for (let token of tokens) {
            if (token.loc.start.line >= position.line + 1 && token.loc.end.line <= position.line + 1&&
                token.loc.start.column <= position.character + 1 && token.loc.end.column >= position.character + 1) {
                result = token;
                break;
            }
        }
        return result;
    }

    async getSelector(document: TextDocument, token: PugAttributeToken): Promise<FindSelectorResult> {
        let result: FindSelectorResult = {
            tag: null,
            attribute: token.name
        };
        const tokens = await this.parse(document);
        let index: number = tokens.indexOf(token);
        while (--index > 0 && (tokens[index].type === 'attribute' || tokens[index].type === 'start-attributes' || 
            tokens[index].type === 'class' || tokens[index].type === 'id')) { /* loop */ }
        if (index >= 0 && tokens[index].type === 'tag' && typeof tokens[index].val === 'string') {
            result.tag = <string>tokens[index].val;
        }
        return result;
    }
}