// The installed GSAP package exposes JavaScript entrypoints without declaration
// files in this workspace. Keep the app build type-safe at the boundary until
// the dependency is upgraded to a typed release.
declare module "gsap" {
  type AnimationTarget = string | Element | Record<string, unknown>;
  type AnimationVars = Record<string, unknown>;

  interface Timeline {
    fromTo(target: AnimationTarget, fromVars: AnimationVars, toVars: AnimationVars, position?: string): Timeline;
  }

  interface GsapStatic {
    registerPlugin(...plugins: unknown[]): void;
    timeline(options?: AnimationVars): Timeline;
    fromTo(target: AnimationTarget, fromVars: AnimationVars, toVars: AnimationVars): unknown;
    to(target: AnimationTarget, vars: AnimationVars): unknown;
    utils: { toArray(selector: string): Element[] };
  }

  export const gsap: GsapStatic;
  const defaultExport: GsapStatic;
  export default defaultExport;
}

declare module "gsap/ScrollTrigger" {
  export const ScrollTrigger: unknown;
  const defaultExport: unknown;
  export default defaultExport;
}
