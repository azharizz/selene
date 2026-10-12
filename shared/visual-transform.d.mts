export type Operation = {name: string; values: number[]};
export type Pair = {name: string; from: number[]; to: number[]};
export function multiply(left: number[], right: number[]): number[];
export function parseTransform(value?: string, css?: boolean): Operation[];
export function operationsMatrix(operations: Operation[]): number[];
export function transformMatrix(value: string, css?: boolean): number[];
export function decompose(matrix: number[]): Operation[];
export function interpolationPlan(from: string, to: string): Pair[];
export function animationPose(keyframes: {opacity?: number; transform?: string}[], progress: number, plans?: Pair[][]): {matrix: number[]; opacity: number};
