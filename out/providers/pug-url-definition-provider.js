"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vscode = require("vscode");
const get_file_location_or_null_1 = require("../utils/get-file-location-or-null");
const get_full_path_or_null_1 = require("../utils/get-full-path-or-null");
const timers_1 = require("timers");
class PugUrlDefinitionProvider {
    constructor() {
        this._tagNameRegex = /^(?!include|\.|#|\/\/)(?:\s+)?([a-zA-Z0-9_$-]+)((?:\.[a-zA-Z_-]+)+)?(?:\(|\s|$)[^,\)]/gm;
        this._tagAttributesRegex = /[a-zA-Z_$]((?:\s+)?\((?:(?:(?:\s+)?[^\s]+(?:\s+)?=(?:\s+)?(?:(?:(['"])[^\n\r]+\2)|(?:require(?:\s+)?\(["'][^\s"']+["']\)))\,?)|(?:(?:\s+)?(?:#|)[a-zA-Z-_]+)\,?(?:\s+)?)+\))/gm;
        this._attributeSelectorRegex = /(\[[$a-zA-Z0-9_]+\]|\[\([$a-zA-Z0-9_]+\)\]|\([$a-zA-Z0-9_]+\)|[$a-zA-Z0-9_]+)(?:(?:\s+)*=(?:\s+)*((["'])[^\n\r]+\3)?|\,|(?:\s+)?\))/g;
        this._tagUriCache = {};
        this._tagClearCacheTimeout = {};
        this._templateUrlCache = {};
        this._templateUrlClearCacheTimeout = {};
    }
    _checkIncludesUri(document, position, token) {
        const wordRange = document.getWordRangeAtPosition(position, /[\s+]?include[\s]+((?:(?:[^<>:;,?"*|\\\/\n\r]+)?[\\\/](?:[^<>:;,?"*|\\\/\n\r]+))+)/g);
        let result;
        if (wordRange !== null && wordRange !== undefined) {
            let relativeUri = document.getText(wordRange);
            let match = /[\s+]?include[\s]+((?:(?:[^<>:;,?"*|\\\/\n\r]+)?[\\\/](?:[^<>:;,?"*|\\\/\n\r]+))+)/g.exec(relativeUri);
            if (match !== null) {
                relativeUri = match[1];
            }
            if (relativeUri !== null && relativeUri !== undefined) {
                if (relativeUri.endsWith('.pug') || relativeUri.endsWith('.jade')) {
                    result = get_file_location_or_null_1.getFileLocationOrNull(document, position, relativeUri);
                }
                else {
                    result = new Promise(resolve => {
                        Promise.all([
                            get_file_location_or_null_1.getFileLocationOrNull(document, position, `${relativeUri}.pug`),
                            get_file_location_or_null_1.getFileLocationOrNull(document, position, `${relativeUri}.jade`)
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
            }
            else {
                result = null;
            }
        }
        else {
            result = null;
        }
        return result;
    }
    _checkFileContainsMixin(mixin, filePath, originSelectionRange) {
        return new Promise(resolve => {
            const regex = new RegExp(`^(?:[\\n\\r]?[\\s]+)?mixin(?:[\\s]+)?${mixin.startsWith('+') ? mixin.substr(1) : mixin}`, 'gm');
            vscode.workspace.openTextDocument(vscode.Uri.file(filePath))
                .then(pugFileDocument => {
                const documentText = pugFileDocument.getText();
                const match = regex.exec(documentText);
                if (match) {
                    const identaionRegex = /[\s]+/;
                    const startPosition = pugFileDocument.positionAt(match.index + 1);
                    const mixinIndentation = startPosition.character;
                    let endLineNumber = startPosition.line;
                    let endCharacterNumber = -1;
                    while (++endLineNumber < pugFileDocument.lineCount && endCharacterNumber < 0) {
                        const line = pugFileDocument.lineAt(endLineNumber);
                        const match = identaionRegex.exec(line.text);
                        if (match && match[0] && match[0].length <= mixinIndentation) {
                            endCharacterNumber = line.text.length;
                        }
                        else if (match === null || match === undefined) {
                            endCharacterNumber = pugFileDocument.lineAt(--endLineNumber).text.length;
                        }
                    }
                    const endPosition = new vscode.Position(endLineNumber, endCharacterNumber);
                    const link = {
                        originSelectionRange: originSelectionRange,
                        targetUri: vscode.Uri.file(filePath),
                        targetRange: new vscode.Range(startPosition, endPosition),
                        targetSelectionRange: new vscode.Range(startPosition, new vscode.Position(startPosition.line, pugFileDocument.lineAt(startPosition.line).text.length))
                    };
                    resolve(link);
                }
                else {
                    resolve(null);
                }
            }, errors => {
                resolve(null);
            });
        });
    }
    _getIncludesPaths(document) {
        return new Promise(resolve => {
            const result = [];
            const documentText = document.getText();
            const regex = /[\s+]?include[\s]+((?:(?:[^<>:;,?"*|\\\/\n\r]+)?[\\\/](?:[^<>:;,?"*|\\\/\n\r]+))+)/g;
            let match;
            const fileCheckTasks = [];
            while (match = regex.exec(documentText)) {
                const includeFileName = match[1];
                if (includeFileName !== null && includeFileName !== undefined) {
                    if (includeFileName.endsWith('.jade') || includeFileName.endsWith('.pug')) {
                        fileCheckTasks.push(get_full_path_or_null_1.getFullPathOrNull(document, includeFileName));
                    }
                    else {
                        fileCheckTasks.push(get_full_path_or_null_1.getFullPathOrNull(document, `${includeFileName}.pug`));
                        fileCheckTasks.push(get_full_path_or_null_1.getFullPathOrNull(document, `${includeFileName}.jade`));
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
    _checkMixinsUri(document, position, token) {
        const wordRange = document.getWordRangeAtPosition(position, /^(?:[\s]+)?\+([^()\+\s]+)/gm);
        let result;
        if (wordRange !== null && wordRange !== undefined) {
            let mixinName = document.getText(wordRange);
            let match = /\+[^+\(\s]+/g.exec(mixinName);
            if (match !== null) {
                mixinName = match[0];
            }
            if (mixinName !== null && mixinName !== undefined) {
                result = new Promise(resolve => {
                    let filePaths = [
                        document.fileName
                    ];
                    const findMixinTasks = [];
                    const links = [];
                    this._getIncludesPaths(document)
                        .then(paths => {
                        filePaths = [...filePaths, ...paths];
                        let range = (match !== null && match !== undefined) ? new vscode.Range(new vscode.Position(wordRange.start.line, match.index), new vscode.Position(wordRange.start.line, match.index + match[0].length)) : wordRange;
                        for (let path of filePaths) {
                            findMixinTasks.push(this._checkFileContainsMixin(mixinName, path, range));
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
            }
            else {
                result = null;
            }
        }
        else {
            result = null;
        }
        return result;
    }
    _checkFileForTagName(tagName, uri, originSelectionRange, token) {
        return new Promise((resolve, reject) => {
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
                    const link = {
                        originSelectionRange: originSelectionRange,
                        targetUri: vscode.Uri.file(document.fileName),
                        targetRange: new vscode.Range(startPosition, endPosition),
                        targetSelectionRange: new vscode.Range(startPosition, new vscode.Position(startPosition.line, document.lineAt(startPosition.line).text.length))
                    };
                    resolve({
                        uri: uri,
                        location: link
                    });
                }
                else {
                    resolve({ uri: uri, location: null });
                }
            }, error => {
                reject(error);
            });
        });
    }
    _findLocationWithTagNameCached(tagName, originSelectionRange, token) {
        if (this._tagUriCache[tagName] === null || this._tagUriCache[tagName] === undefined) {
            return Promise.reject(null);
        }
        return new Promise((resolve, reject) => {
            let result = [];
            let checkTasks = [];
            for (let uri of this._tagUriCache[tagName]) {
                checkTasks.push(this._checkFileForTagName(tagName, uri, originSelectionRange, token));
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
                }
                else {
                    reject(null);
                }
            }).catch(error => {
                reject(error);
            });
        });
    }
    _findLocationsWithSelector(tag, originSelectionRange, token) {
        if (tag === null || tag === undefined) {
            return Promise.resolve({
                selector: tag,
                links: null
            });
        }
        return new Promise(resolve => {
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
                    let result = [];
                    let checkTasks = [];
                    for (let file of sourceFiles) {
                        checkTasks.push(this._checkFileForTagName(tag, file, originSelectionRange, token));
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
                                timers_1.clearTimeout(this._tagClearCacheTimeout[tag]);
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
    _findAttributeWithSelector(uri, attribute, originSelectionRange, token) {
        if (attribute === null || attribute === undefined || token.isCancellationRequested) {
            return Promise.resolve({
                uri: uri,
                location: null
            });
        }
        return new Promise(resolve => {
            vscode.workspace.openTextDocument(uri)
                .then(document => {
                const selectorName = attribute.replace(/(\[|\(|\]|\))/g, '');
                const attributrSelectorRegex = new RegExp(`@(Input|Output|Optional)\\((?:(['"])${selectorName}\\2)\\)(?:\\s+)([\\w]+)`, "gi");
                const attributrNameRegex = new RegExp(`@(Input|Output|Optional)\\((?:\\s+)?\\)(?:\\s+)${selectorName}`, "gi");
                const selectorMatch = attributrSelectorRegex.exec(document.getText());
                const nameMatch = attributrNameRegex.exec(document.getText());
                if (selectorMatch) {
                    const startPosition = document.positionAt(selectorMatch.index + selectorMatch[0].length - (selectorMatch[3] ? selectorMatch[3].length : 1));
                    const endPosition = document.positionAt(selectorMatch.index + selectorMatch[0].length);
                    const link = {
                        originSelectionRange: originSelectionRange,
                        targetUri: vscode.Uri.file(document.fileName),
                        targetRange: new vscode.Range(startPosition, endPosition),
                        targetSelectionRange: new vscode.Range(startPosition, new vscode.Position(startPosition.line, document.lineAt(startPosition.line).text.length))
                    };
                    resolve({
                        uri: uri,
                        location: link
                    });
                }
                else if (nameMatch) {
                    const startPosition = document.positionAt(nameMatch.index + nameMatch[0].length - selectorName.length);
                    const endPosition = document.positionAt(nameMatch.index + nameMatch[0].length);
                    const link = {
                        originSelectionRange: originSelectionRange,
                        targetUri: vscode.Uri.file(document.fileName),
                        targetRange: new vscode.Range(startPosition, endPosition),
                        targetSelectionRange: new vscode.Range(startPosition, new vscode.Position(startPosition.line, document.lineAt(startPosition.line).text.length))
                    };
                    resolve({
                        uri: uri,
                        location: link
                    });
                }
                else {
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
    _checkNgSelectorUri(document, position, token) {
        const tagNameRegex = /^(?:\s+)?([a-zA-Z0-9_$-]+)((?:\.[a-zA-Z_0-9-]+)+)?(?:\(|\s|$)[^,\)]*/;
        const wordRange = document.getWordRangeAtPosition(position, tagNameRegex);
        let result = null;
        if (wordRange !== null && wordRange !== undefined) {
            const line = document.lineAt(wordRange.start);
            let tagMatch = /^(?:((?!include|\.)(?:\s+))?([a-zA-Z0-9_-]+))/.exec(line.text);
            const tagNameStart = tagMatch && tagMatch[1] && tagMatch[1].length || 0;
            const tagNameEnd = tagNameStart + (tagMatch && tagMatch[2] && tagMatch[2].length || 0);
            if (tagMatch && position.character >= tagNameStart && position.character <= tagNameEnd) {
                const tagName = tagMatch[2];
                const originSelectionRange = new vscode.Range(new vscode.Position(line.lineNumber, line.firstNonWhitespaceCharacterIndex), new vscode.Position(line.lineNumber, line.firstNonWhitespaceCharacterIndex + (tagName && tagName.length || 0)));
                result = this._findLocationsWithSelector(tagName, originSelectionRange, token)
                    .then(result => result.links);
            }
        }
        return result;
    }
    _findSelectorName(document, position) {
        let result = {
            tag: null,
            attribute: null
        };
        const tagNameRegex = new RegExp(this._tagNameRegex, "gm");
        const attributeSelectorRegex = new RegExp(this._attributeSelectorRegex, "g");
        const isEndOfDeclaration = (line) => {
            let result = false;
            let openedCount = 0;
            tagNameRegex.lastIndex = 0;
            if (tagNameRegex.test(line)) {
                tagNameRegex.lastIndex = 0;
                result = true;
            }
            else {
                for (let i = 0, l = line.length; i < l; ++i) {
                    if (line[i] === ')') {
                        if (--openedCount < 0) {
                            result = true;
                            break;
                        }
                    }
                    else if (line[i] === '(') {
                        ++openedCount;
                    }
                }
            }
            return result;
        };
        const isBeginningOfDeclaration = (line) => {
            return /^(?:\s+)?[.#a-zA-Z_-]+\(/.test(line);
        };
        let searchText = document.lineAt(position.line).text;
        let upLine = position.line;
        let downLine = position.line;
        let tagMatch = tagNameRegex.exec(searchText);
        let attributeMatch = attributeSelectorRegex.exec(searchText);
        let foundTag = tagMatch && tagMatch[1] || null;
        let foundAttribute = attributeMatch && !attributeMatch[2] && !attributeMatch[3] && attributeMatch[1] || null;
        let range = new vscode.Range(new vscode.Position(upLine, 0), new vscode.Position(downLine, 0));
        let wentToEnd = false;
        let wentToBeginning = false;
        let count = 0;
        while (foundAttribute === null && downLine < document.lineCount - 1 && !wentToEnd) {
            tagNameRegex.lastIndex = 0;
            attributeSelectorRegex.lastIndex = 0;
            range = new vscode.Range(new vscode.Position(upLine, 0), new vscode.Position(downLine, document.lineAt(Math.min(downLine, document.lineCount)).text.length));
            searchText = document.getText(document.validateRange(range));
            tagMatch = tagNameRegex.exec(searchText);
            attributeMatch = attributeSelectorRegex.exec(searchText);
            foundTag = foundTag || tagMatch && tagMatch[1] || null;
            foundAttribute = foundAttribute || attributeMatch && !attributeMatch[2] && !attributeMatch[3] && attributeMatch[1] || null;
            if (isEndOfDeclaration(document.lineAt(downLine).text)) {
                wentToEnd = true;
            }
            else {
                downLine++;
            }
            if (++count > 100) {
                break;
            }
        }
        while (foundTag === null && upLine > 0 && !wentToBeginning) {
            tagNameRegex.lastIndex = 0;
            attributeSelectorRegex.lastIndex = 0;
            range = new vscode.Range(new vscode.Position(upLine, 0), new vscode.Position(downLine, document.lineAt(Math.min(downLine, document.lineCount)).text.length));
            searchText = document.getText(document.validateRange(range));
            tagMatch = tagNameRegex.exec(searchText);
            attributeMatch = attributeSelectorRegex.exec(searchText);
            foundTag = foundTag || tagMatch && tagMatch[1] || null;
            foundAttribute = foundAttribute || attributeMatch && !attributeMatch[2] && !attributeMatch[3] && attributeMatch[1] || null;
            if (isBeginningOfDeclaration(document.lineAt(upLine).text)) {
                wentToBeginning = true;
            }
            else {
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
    _checkTagAttributeSelectorUri(document, position, token) {
        const attributeSelectorRegex = /\[[$a-zA-Z0-9_-]+\]|\[\([$a-zA-Z0-9_-]+\)\]|\([$a-zA-Z0-9_]+\)|[$a-zA-Z0-9_-]+/;
        const wordRange = document.getWordRangeAtPosition(position, attributeSelectorRegex);
        let result = null;
        const attributeName = document.getText(wordRange);
        if (wordRange !== null && wordRange !== undefined) {
            const line = document.lineAt(wordRange.start);
            const checkRegex = new RegExp(`${attributeName.replace(/(\[|\(|\]|\))/g, '\\$1')}(?:(?:\\s+)*=[^=](?:\\s+)*(?:require\\()?((["'])(?:[^\\n\\r,]+|([\\[{])[^\\n\\r]+[\\]}])\\2\\)?)?|\\,|(?:\\s+)?\\))`, "g");
            const match = checkRegex.exec(line.text);
            if (match) {
                if (match[1] === null || match[1] === undefined) {
                    if (!attributeName.startsWith('[')) {
                        result = this._findLocationsWithSelector(`[${attributeName}]`, wordRange, token)
                            .then(result => result.links);
                    }
                    else {
                        result = this._findLocationsWithSelector(attributeName, wordRange, token)
                            .then(result => result.links);
                    }
                }
                else {
                    const selector = this._findSelectorName(document, position);
                    let searchTasks = [];
                    if (selector.tag) {
                        searchTasks.push(this._findLocationsWithSelector(selector.tag, wordRange, token));
                    }
                    if (selector.attribute !== null && selector.attribute !== undefined) {
                        if (!selector.attribute.startsWith('[')) {
                            searchTasks.push(this._findLocationsWithSelector(`[${selector.attribute}]`, wordRange, token));
                        }
                        else {
                            searchTasks.push(this._findLocationsWithSelector(selector.attribute, wordRange, token));
                        }
                    }
                    result = new Promise(resolve => {
                        Promise.all(searchTasks)
                            .then(results => {
                            let searchAttributeTasks = [];
                            for (let taskResult of results) {
                                if (taskResult.links) {
                                    for (let location of taskResult.links) {
                                        searchAttributeTasks.push(this._findAttributeWithSelector(location.targetUri, attributeName, wordRange, token));
                                    }
                                }
                            }
                            Promise.all(searchAttributeTasks)
                                .then(attributeResults => {
                                let locations = [];
                                for (let result of attributeResults) {
                                    if (result.location !== null && result.location !== undefined) {
                                        locations.push(result.location);
                                    }
                                }
                                if (locations.length > 0) {
                                    resolve(locations);
                                }
                                else {
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
    _checkTemplateUrl(pugDocument, uri, originSelectionRange, token) {
        if (token.isCancellationRequested) {
            return Promise.resolve({
                uri: uri,
                location: null
            });
        }
        return new Promise(resolve => {
            vscode.workspace.openTextDocument(uri)
                .then(document => {
                const documentText = document.getText();
                const templateUrlRegex = /templateUrl(?:\s+)?:(?:\s+)?(['"])([\/\w,.\s-]+)\1/g;
                const match = templateUrlRegex.exec(documentText);
                if (match && match[2]) {
                    get_full_path_or_null_1.getFullPathOrNull(document, match[2])
                        .then(fullTemplateUrlPath => {
                        if (fullTemplateUrlPath !== null && fullTemplateUrlPath !== undefined) {
                            if (fullTemplateUrlPath === pugDocument.fileName) {
                                resolve({
                                    uri: uri,
                                    location: {
                                        originSelectionRange: originSelectionRange,
                                        targetUri: document.uri,
                                        targetSelectionRange: new vscode.Range(document.positionAt(match.index - match[2].length - 1), document.positionAt(match.index - 1)),
                                        targetRange: new vscode.Range(document.positionAt(match.index - match[2].length - 1), document.positionAt(match.index - 1))
                                    }
                                });
                            }
                            else {
                                resolve({
                                    uri: uri,
                                    location: null
                                });
                            }
                        }
                        else {
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
                }
                else {
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
    _findLocationWithTemplateUrlCached(pugDocument, originSelectionRange, token) {
        if (this._templateUrlCache[pugDocument.fileName] === null || this._templateUrlCache[pugDocument.fileName] === undefined) {
            return Promise.reject(null);
        }
        return new Promise((resolve, reject) => {
            let result = [];
            let checkTasks = [];
            for (let uri of this._templateUrlCache[pugDocument.fileName]) {
                checkTasks.push(this._checkTemplateUrl(pugDocument, uri, originSelectionRange, token));
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
                }
                else {
                    reject(null);
                }
            }).catch(error => {
                reject(error);
            });
        });
    }
    _findLocationsWithTemplateUrl(pugDocument, originSelectionRange, token) {
        return new Promise(resolve => {
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
                    let result = [];
                    let checkTasks = [];
                    for (let file of sourceFiles) {
                        checkTasks.push(this._checkTemplateUrl(pugDocument, file, originSelectionRange, token));
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
                                timers_1.clearTimeout(this._templateUrlClearCacheTimeout[pugDocument.fileName]);
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
    _adjustMethodPosition(propertyName, link) {
        return new Promise(resolve => {
            vscode.workspace.openTextDocument(link.targetUri)
                .then(document => {
                const functionRegex = new RegExp(`^((?:\\s+)?(?:(?:public|private|protected)(?:\\s+))?)${propertyName}(?:\\s+)?\\(([a-zA-Z:\\s,\\n\\r.?$]+|)\\)(?:\\s+)?:?[a-zA-Z\\s:]+\\{`, 'gm');
                const match = functionRegex.exec(document.getText());
                if (match) {
                    link.targetRange = new vscode.Range(document.positionAt(match.index + (match[1] ? match[1].length : 0)), document.positionAt(match.index + (match[1] ? match[1].length : 0) + propertyName.length));
                    link.targetSelectionRange = new vscode.Range(document.positionAt(match.index + (match[1] ? match[1].length : 0)), document.positionAt(match.index + (match[1] ? match[1].length : 0) + propertyName.length));
                }
                resolve(link);
            }, () => {
                resolve(link);
            });
        });
    }
    _checkFunctionDefinition(document, position, token) {
        const functionRegex = /([\w$]+)\(([^\r\n=]*?|[[(][^\r\n=]*[}\]])\)/;
        const wordRange = document.getWordRangeAtPosition(position, functionRegex);
        let result = null;
        if (wordRange !== null && wordRange !== undefined) {
            const match = functionRegex.exec(document.getText(wordRange));
            const line = document.lineAt(position);
            if (match) {
                if (wordRange.start.character === 0 || wordRange.start.character > 0 &&
                    !/[\.?\])+-=]/.test(line.text[wordRange.start.character - 1])) {
                    const propertyName = match[1];
                    const originSelectionRange = new vscode.Range(new vscode.Position(wordRange.start.line, wordRange.start.character), new vscode.Position(wordRange.start.line, wordRange.end.character - match[0].length + match[1].length));
                    result = this._findLocationsWithTemplateUrl(document, originSelectionRange, token)
                        .then(result => {
                        const adjustTasks = [];
                        for (let link of result.links || []) {
                            adjustTasks.push(this._adjustMethodPosition(propertyName, link));
                        }
                        return Promise.all(adjustTasks);
                    });
                }
            }
        }
        return result;
    }
    _isProperty(lineText, start, end) {
        let result = true;
        const lineTextLength = lineText.length;
        const spaceRegex = /\s/;
        const excludeRegex = /[.\-#\/}\w]/;
        let hadDoubleCurlyLeft = false;
        let hadDoubleCurlyRight = false;
        const hadDoubleCurly = () => hadDoubleCurlyLeft && hadDoubleCurlyRight;
        let firstNonSpaceBefore = null;
        let firstNonSpaceAfter = null;
        while (start > 1 || end < lineTextLength - 2) {
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
            end = Math.min(lineTextLength - 2, ++end);
        }
        if (hadDoubleCurly() && result) {
            result = !(firstNonSpaceBefore === "\"" && firstNonSpaceAfter === "\"") &&
                !(firstNonSpaceBefore === "\'" && firstNonSpaceAfter === "\'");
        }
        return result;
    }
    _checkPropertyPosition(propertyName, link) {
        return new Promise(resolve => {
            vscode.workspace.openTextDocument(link.targetUri)
                .then(document => {
                const documentText = document.getText(new vscode.Range(link.targetRange.start, document.positionAt(document.getText().length)));
                const skippedLength = document.getText(new vscode.Range(document.positionAt(0), link.targetRange.start)).length;
                const constructorRegex = new RegExp(`(constructor(?:[\\s\\S]+)?(?:private|public|protected)\\s+)${propertyName}(?:\\s+)?:?`, 'm');
                const getterRegex = new RegExp(`^((?:\\s+)?(?:(?:public|private|protected)(?:\\s+))?(?:get|set)(?:\\s+))${propertyName}(?:\\s+)?\\(([a-zA-Z:\\s,\\n\\r.?$]+|)\\)(?:\\s+)?:?[a-zA-Z\\s:]+\\{`, 'gm');
                const anyRegex = new RegExp(`(?:[^\\w-\\\\\\/.])${propertyName}(?!\\.|(?:\\s+)?=(?:\\s+)?|\\w):?|(private|public|protected)\\s*${propertyName}[^\\w]`);
                const match = constructorRegex.exec(documentText) || getterRegex.exec(documentText) || anyRegex.exec(documentText);
                if (match) {
                    link.targetRange = new vscode.Range(document.positionAt(skippedLength + match.index + (match[1] ? match[1].length : anyRegex ? 1 : 0)), document.positionAt(skippedLength + 1 + match.index + (match[1] ? match[1].length : anyRegex ? 1 : 0) + propertyName.length));
                    link.targetSelectionRange = new vscode.Range(document.positionAt(skippedLength + match.index + (match[1] ? match[1].length : anyRegex ? 1 : 0)), document.positionAt(skippedLength + match.index + (match[1] ? match[1].length : anyRegex ? 1 : 0) + propertyName.length));
                    resolve(link);
                }
                else {
                    resolve(null);
                }
            }, () => {
                resolve(link);
            });
        });
    }
    _checkPropertyDefinition(document, position, token) {
        const excludeRegex = /(?!\d|\W)[^\s-+=.'"()[\]{}!]+/;
        const wordRange = document.getWordRangeAtPosition(position, excludeRegex);
        let result = null;
        if (wordRange !== null && wordRange !== undefined) {
            const lineText = document.lineAt(wordRange.start).text;
            try {
                if (this._isProperty(lineText, wordRange.start.character, wordRange.end.character)) {
                    result = this._findLocationsWithTemplateUrl(document, wordRange, token)
                        .then(result => {
                        const adjustTasks = [];
                        for (let link of result.links || []) {
                            adjustTasks.push(this._checkPropertyPosition(document.getText(wordRange), link));
                        }
                        return Promise.all(adjustTasks.filter(link => link !== null && link !== undefined));
                    });
                }
            }
            catch (e) {
                console.error(e);
            }
        }
        return result;
    }
    provideDefinition(document, position, token) {
        return this._checkIncludesUri(document, position, token) ||
            this._checkMixinsUri(document, position, token) ||
            this._checkNgSelectorUri(document, position, token) ||
            this._checkTagAttributeSelectorUri(document, position, token) ||
            this._checkFunctionDefinition(document, position, token) ||
            this._checkPropertyDefinition(document, position, token);
    }
}
exports.PugUrlDefinitionProvider = PugUrlDefinitionProvider;
//# sourceMappingURL=pug-url-definition-provider.js.map