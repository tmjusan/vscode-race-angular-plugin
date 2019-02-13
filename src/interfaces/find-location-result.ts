import { LocationLink } from "vscode";

export interface FindLocationResult {
    selector: string | null;
    links: Array<LocationLink> | null;
}