import * as vscode from 'vscode';
import { getFileLocationOrNull } from '../utils/get-file-location-or-null';
import { getFullPathOrNull } from '../utils/get-full-path-or-null';
import { CheckFileResult } from '../interfaces/check-file-result';
import { clearTimeout } from 'timers';
import { FindSelectorResult } from '../interfaces/find-selector-result';
import { FindLocationResult } from '../interfaces/find-location-result';

export class PugUrlDefinitionProvider implements vscode.DefinitionProvider {

    private readonly _tagNameRegex = /^(?!include|\.|#|\/\/)(?:\s+)?([a-zA-Z0-9_$-]+)((?:\.[a-zA-Z_-]+)+)?(?:\(|\s|$)[^,\)]/gm;
    private readonly _tagAttributesRegex = /[a-zA-Z_$]((?:\s+)?\((?:(?:(?:\s+)?[^\s]+(?:\s+)?=(?:\s+)?(?:(?:(['"])[^\n\r]+\2)|(?:require(?:\s+)?\(["'][^\s"']+["']\)))\,?)|(?:(?:\s+)?(?:#|)[a-zA-Z-_]+)\,?(?:\s+)?)+\))/gm;
    private readonly _attributeSelectorRegex = /(\[[$a-zA-Z0-9_]+\]|\[\([$a-zA-Z0-9_]+\)\]|\([$a-zA-Z0-9_]+\)|[$a-zA-Z0-9_]+)(?:(?:\s+)*=(?:\s+)*((["'])[^\n\r]+\3)?|\,|(?:\s+)?\))/g;
    
    private readonly _tagUriCache: {[tagName: string]: Array<vscode.Uri>} = {};
    private _tagClearCacheTimeout: {[tagName: string]: NodeJS.Timeout} = {};
    
    private _checkIncludesUri(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null {
        const wordRange = document.getWordRangeAtPosition(position, /[\s+]?include[\s]+((?:(?:[^<>:;,?"*|\\\/\n\r]+)?[\\\/](?:[^<>:;,?"*|\\\/\n\r]+))+)/g);
        let result: Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null;

        if (wordRange !== null && wordRange !== undefined) {
            let relativeUri = document.getText(wordRange);
            let match = /[\s+]?include[\s]+((?:(?:[^<>:;,?"*|\\\/\n\r]+)?[\\\/](?:[^<>:;,?"*|\\\/\n\r]+))+)/g.exec(relativeUri);
            if (match !== null) {
                relativeUri = match[1];
            }
            if (relativeUri !== null && relativeUri !== undefined) {
                if (relativeUri.endsWith('.pug') || relativeUri.endsWith('.jade')) {
                    result = getFileLocationOrNull(document, position, relativeUri);
                } else {
                    result = new Promise<Array<vscode.LocationLink> | null>(resolve => {
                        Promise.all([
                            getFileLocationOrNull(document, position, `${relativeUri}.pug`),
                            getFileLocationOrNull(document, position, `${relativeUri}.jade`)
                        ]).then(results => {
                            for (let result of results) {
                                if (result) {
                                    resolve(result);
                                    return;
                                }
                            }
                            resolve(null);
                        }).catch(errors => {
                            resolve(null);
                        });
                    });
                }
            } else {
                result = null;
            }
        } else {
            result = null;
        }

        return result;
    }

    private _checkFileContainsMixin(mixin: string, filePath: string, originSelectionRange?: vscode.Range): Promise<vscode.LocationLink | null> {
        return new Promise<vscode.LocationLink | null>(resolve => {
            const regex = new RegExp(`^(?:[\\n\\r]?[\\s]+)?mixin(?:[\\s]+)?${mixin.startsWith('+') ? mixin.substr(1) : mixin}`, 'gm');
            vscode.workspace.openTextDocument(vscode.Uri.file(filePath))
                .then(pugFileDocument => {
                    const documentText = pugFileDocument.getText();
                    const match = regex.exec(documentText);
                    if (match) {
                        const identaionRegex = /[\s]+/;
                        const startPosition = pugFileDocument.positionAt(match.index + 1);
                        const mixinIndentation: number = startPosition.character;
                        let endLineNumber = startPosition.line;
                        let endCharacterNumber = -1;
                        while (++endLineNumber < pugFileDocument.lineCount && endCharacterNumber < 0) {
                            const line = pugFileDocument.lineAt(endLineNumber);
                            const match = identaionRegex.exec(line.text);
                            if (match && match[0] && match[0].length <= mixinIndentation) {
                                endCharacterNumber = line.text.length;
                            } else if (match === null || match === undefined) {
                                endCharacterNumber = pugFileDocument.lineAt(--endLineNumber).text.length;
                            }
                        }
                        const endPosition = new vscode.Position(endLineNumber, endCharacterNumber);
                        const link: vscode.LocationLink = {
                            originSelectionRange: originSelectionRange,
                            targetUri: vscode.Uri.file(filePath),
                            targetRange: new vscode.Range(startPosition, endPosition),
                            targetSelectionRange: new vscode.Range(startPosition, 
                                new vscode.Position(
                                    startPosition.line, 
                                    pugFileDocument.lineAt(startPosition.line).text.length
                                    )
                                )
                        };
                        resolve(link);
                    } else {
                        resolve(null);
                    }
                }, errors => {
                    resolve(null);
                });
        });
    }

    private _getIncludesPaths(document: vscode.TextDocument): Promise<Array<string>> {
        return new Promise<Array<string>>(resolve => {
            const result: Array<string> = [];
            const documentText = document.getText();
            const regex = /[\s+]?include[\s]+((?:(?:[^<>:;,?"*|\\\/\n\r]+)?[\\\/](?:[^<>:;,?"*|\\\/\n\r]+))+)/g;
            let match;
            const fileCheckTasks: Array<Promise<string | null>> = [];
            while (match = regex.exec(documentText)) {
                const includeFileName = match[1];
                if (includeFileName !== null && includeFileName !== undefined) {
                    if (includeFileName.endsWith('.jade') || includeFileName.endsWith('.pug')) {
                        fileCheckTasks.push(getFullPathOrNull(document, includeFileName));
                    } else {
                        fileCheckTasks.push(getFullPathOrNull(document, `${includeFileName}.pug`));
                        fileCheckTasks.push(getFullPathOrNull(document, `${includeFileName}.jade`));
                    }
                }
            }
            Promise.all(fileCheckTasks)
                .then(results => {
                    for (let value of results) {
                        if (value !== null && value !== undefined) {
                            result.push(value);
                        }
                    }
                    resolve(result);
                }).catch(errors => {
                    if (errors !== null && errors !== undefined) {
                        console.error(errors);
                    }
                    resolve(result);
                });
        });
    }

    private _checkMixinsUri(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null {
        const wordRange = document.getWordRangeAtPosition(position, /^(?:[\s]+)?\+([^()\+\s]+)/gm);

        let result: Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null;
        if (wordRange !== null && wordRange !== undefined) {
            let mixinName = document.getText(wordRange);
            let match = /\+[^+\(\s]+/g.exec(mixinName);
            if (match !== null) {
                mixinName = match[0];
            }
            if (mixinName !== null && mixinName !== undefined) {
                result = new Promise<Array<vscode.LocationLink> | null>(resolve => {
                    let filePaths: Array<string> = [
                        document.fileName
                    ];
                    const findMixinTasks: Array<Promise<vscode.LocationLink | null>> = [];
                    const links: Array<vscode.LocationLink> = [];
                    this._getIncludesPaths(document)
                        .then(paths => {
                            filePaths = [...filePaths, ...paths];
                            let range: vscode.Range = (match !== null && match !== undefined) ? new vscode.Range(
                                new vscode.Position(wordRange.start.line, match.index),
                                new vscode.Position(wordRange.start.line, match.index + match[0].length)
                            ) : wordRange;
                            for (let path of filePaths) {
                                findMixinTasks.push(
                                    this._checkFileContainsMixin(mixinName, path, range)
                                );
                            }
                            Promise.all(findMixinTasks)
                                .then(results => {
                                    for (let result of results) {
                                        if (result !== null && result !== undefined) {
                                            links.push(result);
                                        }
                                    }
                                    resolve(links);
                                }).catch(errors => {
                                    if (errors !== null && errors !== undefined) {
                                        console.error(errors);
                                    }
                                    resolve(null);
                                });
                        }).catch(errors => {
                            if (errors !== null && errors !== undefined) {
                                console.error(errors);
                            }
                            resolve(null);
                        });
                });
            } else {
                result = null;
            }
        } else {
            result = null;
        }

        return result;
    }

    private _checkFileForTagName(tagName: string, uri: vscode.Uri, originSelectionRange: vscode.Range, token: vscode.CancellationToken): Promise<CheckFileResult> {
        return new Promise<CheckFileResult>((resolve, reject) => {
            if (token.isCancellationRequested) {
                reject(null);
                return;
            }
            vscode.workspace.openTextDocument(uri)
                .then(document => {
                    const tagRegex = new RegExp(`@(Component|Directive)(?:\\s+)?\\((?:\\s+)?\\{(?:[^]+)?selector(?:\\s+)?:(?:\\s+)?([\'\"])${tagName.replace(/(\[|\(|\]|\))/g, '\\$1')}\\2\\,?(?:[^]+)?\\}(?:\\s+)?\\)`, "i");
                    const match = tagRegex.exec(document.getText());
                    if (match) {
                        const startPosition = document.positionAt(match.index);
                        const endPosition = document.positionAt(match.index + match[0].length);
                        const link: vscode.LocationLink = {
                            originSelectionRange: originSelectionRange,
                            targetUri: vscode.Uri.file(document.fileName),
                            targetRange: new vscode.Range(startPosition, endPosition),
                            targetSelectionRange: new vscode.Range(startPosition, 
                                new vscode.Position(
                                    startPosition.line, 
                                    document.lineAt(startPosition.line).text.length
                                    )
                                )
                        };
                        resolve({
                            uri: uri,
                            location: link
                        });
                    } else {
                        resolve({uri: uri, location: null});
                    }
                }, error => {
                    reject(error);
                });
        });
    }

    private _findLocationWithTagNameCached(tagName: string, originSelectionRange: vscode.Range, token: vscode.CancellationToken): Promise<Array<vscode.LocationLink> | null> {
        if (this._tagUriCache[tagName] === null || this._tagUriCache[tagName] === undefined) {
            return Promise.reject(null);
        }
        return new Promise<Array<vscode.LocationLink> | null>((resolve, reject) => {
            let result: Array<vscode.LocationLink> = [];
            let checkTasks: Array<Promise<CheckFileResult>> = [];
            for (let uri of this._tagUriCache[tagName]) {
                checkTasks.push(
                    this._checkFileForTagName(tagName, uri, originSelectionRange, token)
                );
            }
            Promise.all(checkTasks)
                .then(results => {
                    for (let checkResult of results) {
                        if (checkResult.location !== null && checkResult.location !== undefined) {
                            // Filter similar results
                            const findResult = result.find(loc => {
                                return checkResult.location !== null && checkResult.location !== undefined &&
                                    loc !== null && loc !== undefined && 
                                    loc.targetUri.path === checkResult.location.targetUri.path;
                            });
                            if (findResult === null || findResult === undefined) {
                                result.push(checkResult.location);
                            }
                        }
                    }
                    if (result.length > 0) {
                        resolve(result);
                    } else {
                        reject(null);
                    }
                }).catch(error => {
                    reject(error);
                });
        });
    }

    private _findLocationsWithSelector(tag: string, originSelectionRange: vscode.Range, token: vscode.CancellationToken): Promise<FindLocationResult>  {
        if (tag === null || tag === undefined) {
            return Promise.resolve({
                selector: tag,
                links: null
            });
        }
        return new Promise<FindLocationResult>(resolve => {
            this._findLocationWithTagNameCached(tag, originSelectionRange, token)
                .then(results => {
                    resolve({
                        selector: tag, 
                        links: results
                    });
                })
                .catch(() => {
                    vscode.workspace.findFiles("**/*.{component,directive}.ts", "node_modules/*")
                        .then(sourceFiles => {
                            let result: Array<vscode.LocationLink> = [];
                            let checkTasks: Array<Promise<CheckFileResult>> = [];
                            for (let file of sourceFiles) {
                                checkTasks.push(
                                    this._checkFileForTagName(tag, file, originSelectionRange, token)
                                );
                            }
                            Promise.all(checkTasks)
                                .then(results => {
                                    for (let checkResult of results) {
                                        if (checkResult.location !== null && checkResult.location !== undefined) {
                                            if (this._tagUriCache[tag] === null || this._tagUriCache[tag] === undefined) {
                                                this._tagUriCache[tag] = [];
                                            }
                                            this._tagUriCache[tag].push(checkResult.uri);
                                            // Filter similar results
                                            const findResult = result.find(loc => {
                                                return checkResult.location !== null && checkResult.location !== undefined &&
                                                    loc !== null && loc !== undefined && 
                                                    loc.targetUri.path === checkResult.location.targetUri.path;
                                            });
                                            if (findResult === null || findResult === undefined) {
                                                result.push(checkResult.location);
                                            }
                                        }
                                    }
                                    if (this._tagUriCache[tag] !== null && this._tagUriCache[tag] !== undefined) {
                                        if (this._tagClearCacheTimeout[tag] !== null && this._tagClearCacheTimeout[tag] !== undefined) {
                                            clearTimeout(this._tagClearCacheTimeout[tag]);
                                        }
                                        this._tagClearCacheTimeout[tag] = setTimeout(() => {
                                            delete this._tagUriCache[tag];
                                            delete this._tagClearCacheTimeout[tag];
                                        }, 10 * 60 * 1000); // cache for 10 minutes
                                    }
                                    resolve({
                                        selector: tag, 
                                        links: result
                                    });
                                }).catch(errors => {
                                    if (errors !== null && errors !== undefined) {
                                        console.error(errors);
                                    }
                                    resolve({
                                        selector: tag, 
                                        links: result
                                    });
                                });
                        });
                });
        });
    }

    private _findAttributeWithSelector(uri: vscode.Uri, attribute: string, originSelectionRange: vscode.Range, token: vscode.CancellationToken): Promise<CheckFileResult>  {
        if (attribute === null || attribute === undefined || token.isCancellationRequested) {
            return Promise.resolve({
                uri: uri,
                location: null
            });
        }
        return new Promise<CheckFileResult>(resolve => {
            vscode.workspace.openTextDocument(uri)
                .then(document => {
                    const selectorName: string = attribute.replace(/(\[|\(|\]|\))/g, '');
                    const attributrSelectorRegex = new RegExp(`@(Input|Output|Optional)\\((?:(['"])${selectorName}\\2)\\)(?:\\s+)([\\w]+)`, "gi");
                    const attributrNameRegex = new RegExp(`@(Input|Output|Optional)\\((?:\\s+)?\\)(?:\\s+)${selectorName}`, "gi");
                    const selectorMatch = attributrSelectorRegex.exec(document.getText());
                    const nameMatch = attributrNameRegex.exec(document.getText());
                    if (selectorMatch) {
                        const startPosition = document.positionAt(selectorMatch.index + selectorMatch[0].length - (selectorMatch[3] ? selectorMatch[3].length : 1));
                        const endPosition = document.positionAt(selectorMatch.index + selectorMatch[0].length);
                        const link: vscode.LocationLink = {
                            originSelectionRange: originSelectionRange,
                            targetUri: vscode.Uri.file(document.fileName),
                            targetRange: new vscode.Range(startPosition, endPosition),
                            targetSelectionRange: new vscode.Range(startPosition, 
                                new vscode.Position(
                                    startPosition.line, 
                                    document.lineAt(startPosition.line).text.length
                                    )
                                )
                        };
                        resolve({
                            uri: uri,
                            location: link
                        });
                    } else if (nameMatch) {
                        const startPosition = document.positionAt(nameMatch.index + nameMatch[0].length - selectorName.length);
                        const endPosition = document.positionAt(nameMatch.index + nameMatch[0].length);
                        const link: vscode.LocationLink = {
                            originSelectionRange: originSelectionRange,
                            targetUri: vscode.Uri.file(document.fileName),
                            targetRange: new vscode.Range(startPosition, endPosition),
                            targetSelectionRange: new vscode.Range(startPosition, 
                                new vscode.Position(
                                    startPosition.line, 
                                    document.lineAt(startPosition.line).text.length
                                    )
                                )
                        };
                        resolve({
                            uri: uri,
                            location: link
                        });
                    } else {
                        resolve({uri: uri, location: null});
                    }
                }, () => {
                    resolve({
                        uri: uri,
                        location: null
                    });
                });
        });
    }

    private _checkNgSelectorUri(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null {
        const tagNameRegex = /^(?:\s+)?([a-zA-Z0-9_$-]+)((?:\.[a-zA-Z_-]+)+)?(?:\(|\s|$)[^,\)]*/;
        const wordRange = document.getWordRangeAtPosition(position, tagNameRegex);
        let result: Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null = null;

        if (wordRange !== null && wordRange !== undefined) {
            const line = document.lineAt(wordRange.start);
            let tagMatch = /^(?:(?!include|\.)(?:\s+)?([a-zA-Z0-9_-]+))/.exec(line.text);
            if (tagMatch) {
                const tagName = tagMatch[1];
                const originSelectionRange: vscode.Range = new vscode.Range(
                    new vscode.Position(line.lineNumber, line.firstNonWhitespaceCharacterIndex),
                    new vscode.Position(line.lineNumber, line.firstNonWhitespaceCharacterIndex + (tagName && tagName.length || 0))
                );
                result = this._findLocationsWithSelector(tagName, originSelectionRange, token)
                    .then(result => result.links);
            }
        }

        return result;
    }

    private _findSelectorName(document: vscode.TextDocument, position: vscode.Position): FindSelectorResult {
        let result: FindSelectorResult = {
            tag: null,
            attribute: null
        };
        const tagNameRegex = new RegExp(this._tagNameRegex, "gm");
        const attributeSelectorRegex = new RegExp(this._attributeSelectorRegex, "g");
        const isEndOfDeclaration = (line: string): boolean => {
            let result: boolean = false;
            let openedCount: number = 0;
            tagNameRegex.lastIndex = 0;
            if (tagNameRegex.test(line)) {
                tagNameRegex.lastIndex = 0;
                result = true;
            } else {
                for (let i = 0, l = line.length; i < l; ++i) {
                    if (line[i] === ')') {
                        if (--openedCount < 0) {
                            result = true;
                            break;
                        }
                    } else if (line[i] === '(') {
                        ++openedCount;
                    }
                }
            }
            return result;
        };
        const isBeginningOfDeclaration = (line: string): boolean => {
            return /^(?:\s+)?[.#a-zA-Z_-]+\(/.test(line);
        };
        let searchText = document.lineAt(position.line).text;
        let upLine: number = position.line;
        let downLine: number = position.line;
        let tagMatch = tagNameRegex.exec(searchText);
        let attributeMatch = attributeSelectorRegex.exec(searchText);
        let foundTag: string | null = tagMatch && tagMatch[1] || null;
        let foundAttribute: string | null = attributeMatch && !attributeMatch[2] && !attributeMatch[3] && attributeMatch[1] || null;
        let range: vscode.Range = new vscode.Range(
            new vscode.Position(upLine, 0),
            new vscode.Position(downLine, 0)
        );
        let wentToEnd: boolean = false;
        let wentToBeginning: boolean = false;
        let count: number = 0;
        while(foundAttribute === null && downLine < document.lineCount - 1 && !wentToEnd) {
            tagNameRegex.lastIndex = 0;
            attributeSelectorRegex.lastIndex = 0;
            range = new vscode.Range(
                new vscode.Position(upLine, 0),
                new vscode.Position(downLine, document.lineAt(Math.min(downLine, document.lineCount)).text.length)
            );
            searchText = document.getText(document.validateRange(range));
            tagMatch = tagNameRegex.exec(searchText);
            attributeMatch = attributeSelectorRegex.exec(searchText);
            foundTag = foundTag || tagMatch && tagMatch[1] || null;
            foundAttribute = foundAttribute || attributeMatch && !attributeMatch[2] && !attributeMatch[3] && attributeMatch[1] || null;
            if (isEndOfDeclaration(document.lineAt(downLine).text)) {
                wentToEnd = true;
            } else {
                downLine++;
            }
            if (++count > 100) {
                break;
            }
        }
        while(foundTag === null && upLine > 0 && !wentToBeginning) {
            tagNameRegex.lastIndex = 0;
            attributeSelectorRegex.lastIndex = 0;
            range = new vscode.Range(
                new vscode.Position(upLine, 0),
                new vscode.Position(downLine, document.lineAt(Math.min(downLine, document.lineCount)).text.length)
            );
            searchText = document.getText(document.validateRange(range));
            tagMatch = tagNameRegex.exec(searchText);
            attributeMatch = attributeSelectorRegex.exec(searchText);
            foundTag = foundTag || tagMatch && tagMatch[1] || null;
            foundAttribute = foundAttribute || attributeMatch && !attributeMatch[2] && !attributeMatch[3] && attributeMatch[1] || null;
            if (isBeginningOfDeclaration(document.lineAt(upLine).text)) {
                wentToBeginning = true;
            } else {
                upLine--;
            }
            if (++count > 100) {
                break;
            }
        }
        result = {
            tag: foundTag, 
            attribute: foundAttribute
        };
        return result;
    }

    private _checkTagAttributeSelectorUri(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null {
        const attributeSelectorRegex = /\[[$a-zA-Z0-9_]+\]|\[\([$a-zA-Z0-9_]+\)\]|\([$a-zA-Z0-9_]+\)|[$a-zA-Z0-9_]+/;
        const wordRange = document.getWordRangeAtPosition(position, attributeSelectorRegex);
        let result: Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null = null;
        const attributeName = document.getText(wordRange);

        if (wordRange !== null && wordRange !== undefined) {
            const line = document.lineAt(wordRange.start);
            const checkRegex = new RegExp(`${attributeName.replace(/(\[|\(|\]|\))/g, '\\$1')}(?:(?:\\s+)*=(?:\\s+)*(?:require\\()?((["'])(?:[^\\n\\r,]+|([\\[{])[^\\n\\r]+[\\]}])\\2\\)?)?|\\,|(?:\\s+)?\\))`, "g");
            const match = checkRegex.exec(line.text);
            if (match) {
                if (match[1] === null || match[1] === undefined) {
                    if (!attributeName.startsWith('[')) {
                        result = this._findLocationsWithSelector(`[${attributeName}]`, wordRange, token)
                            .then(result => result.links);
                    } else {
                        result = this._findLocationsWithSelector(attributeName, wordRange, token)
                            .then(result => result.links);
                    }
                } else {
                    const selector = this._findSelectorName(document, position);
                    let searchTasks: Array<Promise<FindLocationResult>> = [];
                    if (selector.tag) {
                        searchTasks.push(this._findLocationsWithSelector(selector.tag, wordRange, token));
                    }
                    if (selector.attribute !== null && selector.attribute !== undefined) {
                        if (!selector.attribute.startsWith('[')) {
                            searchTasks.push(this._findLocationsWithSelector(`[${selector.attribute}]`, wordRange, token));
                        } else {
                            searchTasks.push(this._findLocationsWithSelector(selector.attribute, wordRange, token));
                        }
                    }
                    result = new Promise<Array<vscode.LocationLink> | null>(resolve => {
                        Promise.all(searchTasks)
                            .then(results => {
                                let searchAttributeTasks: Array<Promise<CheckFileResult>> = [];
                                for (let taskResult of results) {
                                    if (taskResult.links) {
                                        for (let location of taskResult.links) {
                                            searchAttributeTasks.push(this._findAttributeWithSelector(location.targetUri, attributeName, wordRange, token));
                                        }
                                    }
                                }
                                Promise.all(searchAttributeTasks)
                                    .then(attributeResults => {
                                        let locations: Array<vscode.LocationLink> = [];
                                        for (let result of attributeResults) {
                                            if (result.location !== null && result.location !== undefined) {
                                                locations.push(result.location);
                                            }
                                        }
                                        if (locations.length > 0) {
                                            resolve(locations);
                                        } else {
                                            resolve(null);
                                        }
                                    }).catch(() => {
                                        resolve(null);
                                    });
                            }).catch(() => {
                                resolve(null);
                            });
                    });
                }
            }
        }
        return result;
    }

    provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.LocationLink[]> {
        return this._checkIncludesUri(document, position, token) || 
            this._checkMixinsUri(document, position, token) ||
            this._checkNgSelectorUri(document, position, token) ||
            this._checkTagAttributeSelectorUri(document, position, token);
    }

}