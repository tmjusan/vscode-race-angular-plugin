import * as vscode from 'vscode';
import { getFileLocationOrNull } from '../utils/get-file-location-or-null';
import { getFullPathOrNull } from '../utils/get-full-path-or-null';
import { CheckFileResult } from '../interfaces/check-file-result';
import { clearTimeout } from 'timers';
import { FindSelectorResult } from '../interfaces/find-selector-result';
import { FindLocationResult } from '../interfaces/find-location-result';
import { PugService } from '../services/pug-service';
import { pugLocationToRange } from '../utils/pug-location-to-range';
import { PugAttributeToken } from '../interfaces/pug-token';

export class PugUrlDefinitionProvider implements vscode.DefinitionProvider {

    private readonly _tagUriCache: { [tagName: string]: Array<vscode.Uri> } = {};
    private _tagClearCacheTimeout: { [tagName: string]: NodeJS.Timeout } = {};

    private readonly _templateUrlCache: { [path: string]: Array<vscode.Uri> } = {};
    private _templateUrlClearCacheTimeout: { [path: string]: NodeJS.Timeout } = {};

    private _pug: PugService = new PugService();

    constructor() {
        /* empty */
    }

    private _checkIncludesUri(document: vscode.TextDocument, relativeUri: string, wordRange: vscode.Range, token: vscode.CancellationToken): Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null {
        let result: Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null = null;

        if (relativeUri !== null && relativeUri !== undefined && wordRange !== null && wordRange !== undefined) {
            if (relativeUri.endsWith('.pug') || relativeUri.endsWith('.jade')) {
                result = getFileLocationOrNull(document, wordRange, relativeUri);
            } else {
                result = new Promise<Array<vscode.LocationLink> | null>(resolve => {
                    Promise.all([
                        getFileLocationOrNull(document, wordRange, `${relativeUri}.pug`),
                        getFileLocationOrNull(document, wordRange, `${relativeUri}.jade`)
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
                        const endPosition = new vscode.Position(endLineNumber, Math.max(endCharacterNumber, 0));
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
                    if (errors) {
                        console.error(errors);
                    }
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

    private _checkMixinsUri(document: vscode.TextDocument, mixinName: string, wordRange: vscode.Range, token: vscode.CancellationToken): Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null {
        let result: Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null;
        if (mixinName !== null && mixinName !== undefined && wordRange !== null && wordRange !== undefined) {
            result = new Promise<Array<vscode.LocationLink> | null>(resolve => {
                let filePaths: Array<string> = [
                    document.fileName
                ];
                const findMixinTasks: Array<Promise<vscode.LocationLink | null>> = [];
                const links: Array<vscode.LocationLink> = [];
                this._getIncludesPaths(document)
                    .then(paths => {
                        filePaths = [...filePaths, ...paths];
                        for (let path of filePaths) {
                            findMixinTasks.push(
                                this._checkFileContainsMixin(mixinName, path, wordRange)
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
            }).catch(e => {
                console.error(e);
                return e;
            });
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
                        resolve({ uri: uri, location: null });
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

    private _findLocationsWithSelector(tag: string, originSelectionRange: vscode.Range, token: vscode.CancellationToken): Promise<FindLocationResult> {
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

    private _findAttributeWithSelector(uri: vscode.Uri, attribute: string, originSelectionRange: vscode.Range, token: vscode.CancellationToken): Promise<CheckFileResult> {
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
                    const attributrNameRegex = new RegExp(`@(Input|Output|Optional)\\((?:\\s+)?\\)\\s*(?:set|get)?\\s*${selectorName}`, "gi");
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
                    } else if (/(\[\(|\(\[)ngModel\)?\]?/i.test(attribute)) {
                        const ngAccessorRegex = new RegExp(`^((?:\\s+)?(?:(?:public|private|protected)(?:\\s+))?)writeValue(?:\\s+)?\\(([a-zA-Z:\\s,\\n\\r.?$]+|)\\)(?:\\s+)?:?[a-zA-Z\\s|:]+\\{`, 'gm');
                        const ngAccessorMath = ngAccessorRegex.exec(document.getText());
                        if (ngAccessorMath) {
                            const startPosition = document.positionAt(ngAccessorMath.index + (ngAccessorMath[1] ? ngAccessorMath[1].length : 0));
                            const endPosition = document.positionAt(ngAccessorMath.index + (ngAccessorMath[1] ? ngAccessorMath[1].length : 0) + ngAccessorMath.length);
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
                            resolve({ uri: uri, location: null });
                        }
                    } else {
                        resolve({ uri: uri, location: null });
                    }
                }, () => {
                    resolve({
                        uri: uri,
                        location: null
                    });
                });
        });
    }

    private _checkNgSelectorUri(selector: string, wordRange: vscode.Range, token: vscode.CancellationToken): Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null {
        let result: Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null = null;
        if (wordRange !== null && wordRange !== undefined) {
            result = this._findLocationsWithSelector(selector, wordRange, token)
                .then(result => result.links);
        }
        return result;
    }

    private _checkTagAttributeSelectorUri(attributeName: string, selector: FindSelectorResult, wordRange: vscode.Range, token: vscode.CancellationToken): Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null {
        let result: Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null = null;

        if (attributeName && wordRange !== null && wordRange !== undefined) {
            const searchTasks: Array<Promise<FindLocationResult>> = [];
            if (selector.tag) {
                searchTasks.push(this._findLocationsWithSelector(selector.tag, wordRange, token));
            }
            if (selector.attribute !== null && selector.attribute !== undefined && !selector.attribute.startsWith('[') && !selector.attribute.startsWith('(') && !selector.attribute.startsWith('*')) {
                searchTasks.push(this._findLocationsWithSelector(`[${selector.attribute}]`, wordRange, token));
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
        return result;
    }

    private _checkTemplateUrl(pugDocument: vscode.TextDocument, uri: vscode.Uri, originSelectionRange: vscode.Range, token: vscode.CancellationToken): Promise<CheckFileResult> {
        if (token.isCancellationRequested) {
            return Promise.resolve({
                uri: uri,
                location: null
            });
        }
        return new Promise<CheckFileResult>(resolve => {
            vscode.workspace.openTextDocument(uri)
                .then(document => {
                    const documentText = document.getText();
                    const templateUrlRegex = /templateUrl(?:\s+)?:(?:\s+)?(['"])([\/\w,.\s-]+)\1/g;
                    const match = templateUrlRegex.exec(documentText);
                    if (match && match[2]) {
                        getFullPathOrNull(document, match[2])
                            .then(fullTemplateUrlPath => {
                                if (fullTemplateUrlPath !== null && fullTemplateUrlPath !== undefined) {
                                    if (fullTemplateUrlPath === pugDocument.fileName) {
                                        resolve({
                                            uri: uri,
                                            location: {
                                                originSelectionRange: originSelectionRange,
                                                targetUri: document.uri,
                                                targetSelectionRange: new vscode.Range(
                                                    document.positionAt(match.index - match[2].length - 1),
                                                    document.positionAt(match.index - 1)
                                                ),
                                                targetRange: new vscode.Range(
                                                    document.positionAt(match.index - match[2].length - 1),
                                                    document.positionAt(match.index - 1)
                                                )
                                            }
                                        });
                                    } else {
                                        resolve({
                                            uri: uri,
                                            location: null
                                        });
                                    }
                                } else {
                                    resolve({
                                        uri: uri,
                                        location: null
                                    });
                                }
                            }).catch(() => {
                                resolve({
                                    uri: uri,
                                    location: null
                                });
                            });
                    } else {
                        resolve({
                            uri: uri,
                            location: null
                        });
                    }
                }, () => {
                    resolve({
                        uri: uri,
                        location: null
                    });
                });
        });
    }

    private _findLocationWithTemplateUrlCached(pugDocument: vscode.TextDocument, originSelectionRange: vscode.Range, token: vscode.CancellationToken): Promise<Array<vscode.LocationLink> | null> {
        if (this._templateUrlCache[pugDocument.fileName] === null || this._templateUrlCache[pugDocument.fileName] === undefined) {
            return Promise.reject(null);
        }
        return new Promise<Array<vscode.LocationLink> | null>((resolve, reject) => {
            let result: Array<vscode.LocationLink> = [];
            let checkTasks: Array<Promise<CheckFileResult>> = [];
            for (let uri of this._templateUrlCache[pugDocument.fileName]) {
                checkTasks.push(
                    this._checkTemplateUrl(pugDocument, uri, originSelectionRange, token)
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

    private _findLocationsWithTemplateUrl(pugDocument: vscode.TextDocument, originSelectionRange: vscode.Range, token: vscode.CancellationToken): Promise<FindLocationResult> {
        return new Promise<FindLocationResult>(resolve => {
            this._findLocationWithTemplateUrlCached(pugDocument, originSelectionRange, token)
                .then(results => {
                    resolve({
                        selector: pugDocument.fileName,
                        links: results
                    });
                })
                .catch(() => {
                    vscode.workspace.findFiles("**/*.component.ts", "node_modules/*")
                        .then(sourceFiles => {
                            let result: Array<vscode.LocationLink> = [];
                            let checkTasks: Array<Promise<CheckFileResult>> = [];
                            for (let file of sourceFiles) {
                                checkTasks.push(
                                    this._checkTemplateUrl(pugDocument, file, originSelectionRange, token)
                                );
                            }
                            Promise.all(checkTasks)
                                .then(results => {
                                    for (let checkResult of results) {
                                        if (checkResult.location !== null && checkResult.location !== undefined) {
                                            if (this._templateUrlCache[pugDocument.fileName] === null || this._templateUrlCache[pugDocument.fileName] === undefined) {
                                                this._templateUrlCache[pugDocument.fileName] = [];
                                            }
                                            this._templateUrlCache[pugDocument.fileName].push(checkResult.uri);
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
                                    if (this._templateUrlCache[pugDocument.fileName] !== null && this._templateUrlCache[pugDocument.fileName] !== undefined) {
                                        if (this._templateUrlClearCacheTimeout[pugDocument.fileName] !== null && this._templateUrlClearCacheTimeout[pugDocument.fileName] !== undefined) {
                                            clearTimeout(this._templateUrlClearCacheTimeout[pugDocument.fileName]);
                                        }
                                        this._templateUrlClearCacheTimeout[pugDocument.fileName] = setTimeout(() => {
                                            delete this._templateUrlCache[pugDocument.fileName];
                                            delete this._templateUrlClearCacheTimeout[pugDocument.fileName];
                                        }, 10 * 60 * 1000); // cache for 10 minutes
                                    }
                                    resolve({
                                        selector: pugDocument.fileName,
                                        links: result
                                    });
                                }).catch(errors => {
                                    if (errors !== null && errors !== undefined) {
                                        console.error(errors);
                                    }
                                    resolve({
                                        selector: pugDocument.fileName,
                                        links: result
                                    });
                                });
                        });
                });
        });
    }

    private _adjustMethodPosition(propertyName: string, link: vscode.LocationLink): Promise<vscode.LocationLink> {
        return new Promise<vscode.LocationLink>(resolve => {
            vscode.workspace.openTextDocument(link.targetUri)
                .then(document => {
                    const functionRegex = new RegExp(`^((?:\\s+)?(?:(?:public|private|protected)(?:\\s+))?)${propertyName}(?:\\s+)?\\(([a-zA-Z:\\s,\\n\\r.?$]+|)\\)(?:\\s+)?:?[a-zA-Z\\s|:]+\\{`, 'gm');
                    const match = functionRegex.exec(document.getText());
                    if (match) {
                        link.targetRange = new vscode.Range(
                            document.positionAt(match.index + (match[1] ? match[1].length : 0)),
                            document.positionAt(match.index + (match[1] ? match[1].length : 0) + propertyName.length)
                        );
                        link.targetSelectionRange = new vscode.Range(
                            document.positionAt(match.index + (match[1] ? match[1].length : 0)),
                            document.positionAt(match.index + (match[1] ? match[1].length : 0) + propertyName.length)
                        );
                    } else {
                        console.warn(`could not find method ${propertyName} in ${link.targetUri.fsPath}`);
                    }
                    resolve(link);
                }, () => {
                    resolve(link);
                });
        });
    }

    private _checkFunctionDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null {
        const functionRegex = /([\w$]+)\(([^\r\n=]*?|[[(][^\r\n=]*[}\]])\)/;
        const wordRange = document.getWordRangeAtPosition(position, functionRegex);
        let result: Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null = null;

        if (wordRange !== null && wordRange !== undefined) {
            const match = functionRegex.exec(document.getText(wordRange));
            const line = document.lineAt(position);
            if (match) {
                if (wordRange.start.character === 0 || wordRange.start.character > 0 &&
                    !/[\.?\])+-=]/.test(line.text[wordRange.start.character - 1])) {
                    const propertyName = match[1];
                    const originSelectionRange: vscode.Range = new vscode.Range(
                        new vscode.Position(wordRange.start.line, wordRange.start.character),
                        new vscode.Position(wordRange.start.line, wordRange.end.character - match[0].length + match[1].length)
                    );
                    if (originSelectionRange.start.character <= position.character && originSelectionRange.end.character >= position.character) {
                        result = this._findLocationsWithTemplateUrl(document, originSelectionRange, token)
                            .then(result => {
                                const adjustTasks: Array<Promise<vscode.LocationLink>> = [];
                                for (let link of result.links || []) {
                                    adjustTasks.push(this._adjustMethodPosition(propertyName, link));
                                }
                                return Promise.all(adjustTasks);
                            });
                    }
                }
            }
        }

        return result;
    }

    private _isProperty(lineText: string, start: number, end: number): boolean {
        let result: boolean = true;
        const lineTextLength: number = lineText.length;
        const spaceRegex = /\s/;
        const quotesRegex = /["']/;
        const excludeRegex = /[.\-#\/}\w]/;

        let hadDoubleCurlyLeft: boolean = false;
        let hadDoubleCurlyRight: boolean = false;
        const hadDoubleCurly = () => hadDoubleCurlyLeft && hadDoubleCurlyRight;
        let firstNonSpaceBefore: string | null = null;
        let firstNonSpaceAfter: string | null = null;

        if (/\d/.test(lineText[start])) {
            result = false;
        }

        while (result && (start > 1 || end < lineTextLength - 2)) {
            start = Math.max(1, --start);
            if (lineText[start] === '{' && lineText[start - 1] === '{') {
                hadDoubleCurlyLeft = true;
            }
            if (lineText[end] === '}' && lineText[end + 1] === '}') {
                hadDoubleCurlyRight = true;
            }
            if (firstNonSpaceBefore === null && !spaceRegex.test(lineText[start])) {
                firstNonSpaceBefore = lineText[start];
                if (excludeRegex.test(firstNonSpaceBefore)) {
                    result = false;
                    break;
                }
            }
            if (firstNonSpaceAfter === null && !spaceRegex.test(lineText[end])) {
                firstNonSpaceAfter = lineText[end];
            }
            if (firstNonSpaceBefore && firstNonSpaceAfter &&
                quotesRegex.test(firstNonSpaceBefore) &&
                excludeRegex.test(firstNonSpaceAfter)) {
                result = true;
                break;
            }

            end = Math.min(lineTextLength - 2, ++end);
        }

        if (hadDoubleCurly() && result) {
            result = !(firstNonSpaceBefore === "\"" && firstNonSpaceAfter === "\"") &&
                !(firstNonSpaceBefore === "\'" && firstNonSpaceAfter === "\'");
        }

        return result;
    }

    private _checkPropertyPosition(propertyName: string, link: vscode.LocationLink, originSelectionRange?: vscode.Range): Promise<vscode.LocationLink | null> {
        return new Promise<vscode.LocationLink | null>(resolve => {
            vscode.workspace.openTextDocument(link.targetUri)
                .then(document => {
                    const documentText: string = document.getText(new vscode.Range(
                        link.targetRange.start,
                        document.positionAt(document.getText().length)
                    ));
                    const skippedLength = document.getText(
                        new vscode.Range(
                            document.positionAt(0),
                            link.targetRange.start
                        )
                    ).length;
                    const constructorRegex = new RegExp(`(constructor(?:[\\s\\S]+)?(?:private|public|protected)\\s+)${propertyName}(?:\\s+)?:?`, 'm');
                    const getterRegex = new RegExp(`^((?:\\s+)?(?:(?:public|private|protected)(?:\\s+))?(?:get|set)(?:\\s+))${propertyName}(?:\\s+)?\\(([a-zA-Z:\\s,\\n\\r.?$]+|)\\)(?:\\s+)?:?[a-zA-Z\\s:]+\\{`, 'gm');
                    const anyRegex = new RegExp(`(?:[^\\w-\\\\\\/.])${propertyName}(?!\\.|(?:\\s+)?=(?:\\s+)?|\\w):?|(private|public|protected)\\s*${propertyName}[^\\w]`);
                    const match = constructorRegex.exec(documentText) || getterRegex.exec(documentText) || anyRegex.exec(documentText);

                    if (match) {
                        link.targetRange = new vscode.Range(
                            document.positionAt(skippedLength + match.index + (match[1] ? match[1].length : anyRegex ? 1 : 0)),
                            document.positionAt(skippedLength + 1 + match.index + (match[1] ? match[1].length : anyRegex ? 1 : 0) + propertyName.length)
                        );
                        link.targetSelectionRange = new vscode.Range(
                            document.positionAt(skippedLength + match.index + (match[1] ? match[1].length : anyRegex ? 1 : 0)),
                            document.positionAt(skippedLength + match.index + (match[1] ? match[1].length : anyRegex ? 1 : 0) + propertyName.length)
                        );
                        if (originSelectionRange !== null && originSelectionRange !== undefined) {
                            link.originSelectionRange = originSelectionRange;
                        }
                        resolve(link);
                    } else {
                        resolve(null);
                    }
                }, () => {
                    resolve(link);
                });
        });
    }

    private _checkPropertyDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null {
        const excludeRegex = /[^\s-+=.'"()[\]{}!]+/;
        let wordRange = document.getWordRangeAtPosition(position, excludeRegex);
        let cursorRange: vscode.Range | null = null;
        let result: Promise<Array<vscode.LocationLink> | null> | Array<vscode.LocationLink> | null = null;

        if (wordRange !== null && wordRange !== undefined) {
            const lineText = document.lineAt(wordRange.start).text;
            let isProperty: boolean = false;

            const ngForCollectionRegex = new RegExp(`let\\s{1,}([\\w]+)\\s{1,}(?:of|in)\\s{1,}${document.getText(wordRange)}[^\\w]`);
            const ngForValueRegex = new RegExp(`(let\\s{1,}${document.getText(wordRange)}\\s{1,}(?:of|in)\\s{1,})(\\w+)`);
            const ngForCollectionMatch = ngForCollectionRegex.exec(lineText);
            const ngForValueMatch = ngForValueRegex.exec(lineText);

            if (ngForCollectionMatch !== null && ngForCollectionMatch !== undefined) {
                isProperty = true;
            } else if (ngForValueMatch !== null && ngForValueMatch !== undefined) {
                cursorRange = document.validateRange(new vscode.Range(
                    new vscode.Position(position.line, ngForValueMatch.index + ngForValueMatch[1].length),
                    new vscode.Position(position.line, ngForValueMatch.index + ngForValueMatch[0].length)
                ));
                isProperty = true;
            } else {
                isProperty = this._isProperty(lineText, wordRange.start.character, wordRange.end.character);
            }
            if (isProperty) {
                result = this._findLocationsWithTemplateUrl(document, cursorRange || wordRange, token)
                    .then(result => {
                        const adjustTasks: Array<Promise<vscode.LocationLink | null>> = [];
                        for (let link of result.links || []) {
                            adjustTasks.push(this._checkPropertyPosition(document.getText(cursorRange || wordRange), link, wordRange));
                        }
                        return Promise.all(<Array<Promise<vscode.LocationLink>>>adjustTasks.filter(link => link !== null && link !== undefined));
                    });
            }
        }

        return result;
    }

    provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.LocationLink[] | null> {
        let result: Promise<vscode.LocationLink[] | null> | vscode.LocationLink[] | null = null;

        return this._pug.getToken(document, position)
            .then(pugToken => {
                if (pugToken) {
                    switch (pugToken.type) {
                        case "path":
                            if (typeof pugToken.val === 'string') {
                                result = this._checkIncludesUri(document, pugToken.val, pugLocationToRange(pugToken.loc), token);
                            }
                            break;
                        case "call":
                            if (typeof pugToken.val === 'string' && position.character <= pugToken.loc.start.column + pugToken.val.length) {
                                result = this._checkMixinsUri(document, <string>pugToken.val, pugLocationToRange(pugToken.loc, pugToken.val.length + 1), token);
                            } else {
                                result = this._checkFunctionDefinition(document, position, token) ||
                                    this._checkPropertyDefinition(document, position, token);
                            }
                            break;
                        case "tag":
                            if (typeof pugToken.val === 'string') {
                                result = this._checkNgSelectorUri(pugToken.val, pugLocationToRange(pugToken.loc), token);
                            }
                            break;
                        case 'class':
                        case 'code':
                        case 'interpolated-code':
                        case 'mixin':
                            break;
                        case "attribute":
                            if (pugToken.name) {
                                if (pugToken.loc.start.column + pugToken.name.length - 1 >= position.character) {
                                    const attributeName: string = pugToken.name;
                                    if (typeof pugToken.val === 'string' || typeof pugToken.val === 'number') {
                                        result = this._pug.getSelector(document, <PugAttributeToken>pugToken)
                                            .then(selector => this._checkTagAttributeSelectorUri(attributeName,
                                                selector, pugLocationToRange(pugToken.loc, attributeName.length),
                                                token));
                                    } else if (pugToken.val === true && !/\[|\]|\(|\)|\*|\#|\@/.test(attributeName)) {
                                        result = this._checkNgSelectorUri(`[${attributeName}]`, pugLocationToRange(pugToken.loc), token);
                                    }
                                } else {
                                    result = this._checkFunctionDefinition(document, position, token) ||
                                        this._checkPropertyDefinition(document, position, token);
                                }
                            }
                            break;
                        case 'text':
                        default:
                            // console.log(pugToken.type, '---', pugToken.val);
                            result = this._checkFunctionDefinition(document, position, token) ||
                                this._checkPropertyDefinition(document, position, token);
                            break;
                    }
                }
                return result;
            });
    }

}