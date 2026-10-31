import type { ProcessContext } from "./context";
import type { ProcessRequest } from "../types";
export interface EffectiveConfiguration {
    carModel: string;
    basePaths: ProcessRequest["basePaths"];
    modelToFiles: ProcessRequest["modelToFiles"];
}
export function configurationFor(ctx: ProcessContext): EffectiveConfiguration {
    return ctx.analysisConfig ?? { carModel: ctx.carModel, basePaths: ctx.request?.basePaths, modelToFiles: ctx.request?.modelToFiles };
}
