import { workspace, TextDocument, Position } from "vscode";
import { PugToken, PugAttributeToken } from "../interfaces/pug-token";
import { FindSelectorResult } from "../interfaces/find-selector-result";

const lex = require('pug-lexer');

export class PugService {

    private _lexCache: { [path: string]: Array<PugToken> } = {};

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
            if (token.loc.start.line >= position.line + 1 && token.loc.end.line <= position.line + 1 &&
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
            attribute: null
        };
        const tokens = await this.parse(document);
        let tagIndex: number = tokens.indexOf(token);
        let attributeIndex: number = tagIndex;

        do {
            if (tokens[tagIndex].type === 'attribute' && tokens[tagIndex].val === true &&
                tokens[tagIndex].name !== undefined && !/\[|\]|\(|\)|\*|\#|\@/.test(<string>tokens[tagIndex].name)) {
                result.attribute = <string>tokens[tagIndex].name;
            }
        } while (--tagIndex > 0 && (tokens[tagIndex].type === 'attribute' || tokens[tagIndex].type === 'start-attributes' ||
            tokens[tagIndex].type === 'class' || tokens[tagIndex].type === 'id'));

        do {
            if (tokens[attributeIndex].type === 'attribute' && tokens[attributeIndex].val === true &&
                tokens[attributeIndex].name !== undefined && !/\[|\]|\(|\)|\*|\#|\@/.test(<string>tokens[attributeIndex].name)) {
                result.attribute = <string>tokens[attributeIndex].name;
            }
        } while (++attributeIndex < tokens.length && tokens[attributeIndex].type === 'attribute');

        if (tagIndex >= 0 && tokens[tagIndex].type === 'tag' && typeof tokens[tagIndex].val === 'string') {
            result.tag = <string>tokens[tagIndex].val;
        }
        return result;
    }
}