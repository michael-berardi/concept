import type { Api } from "./apiTypes";
import { RealApi } from "./real";

export const api: Api = new RealApi();

export * from "./types";
export { ApiError } from "./request";
