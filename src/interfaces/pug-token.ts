type PugTokenType = "include" | "path" | "newline" | "class" | "start-attributes" | "attribute" | "end-attributes" | "indent" | "call" | "tag" | "text" | "outdent" | "comment" | "start-pipeless-text" | "end-pipeless-text" | "eos" | "id" | "mixin" | "interpolated-code" | "code" | "if" | "&attributes" | "text-html" | "else" | "mixin-block" | "each";

export interface PugTokenCoordinates {
    line: number;
    column: number;
}

export interface PugTokenLocation {
    start: PugTokenCoordinates;
    end: PugTokenCoordinates;
}

export interface PugToken {
    type: PugTokenType;
    loc: PugTokenLocation;
    name?: string;
    val?: string | number | boolean;
    args?: string;
    buffer?: boolean;
    key?: string;
    code?: string;
    mustEscape?: boolean;
}

export interface PugAttributeToken extends PugToken {
    type: "attribute";
    loc: PugTokenLocation;
    name: string;
    val?: string;
    mustEscape: boolean;
}