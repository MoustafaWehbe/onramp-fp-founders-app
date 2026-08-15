// The installed GSAP package exposes JavaScript entrypoints without declaration
// files in this workspace. Keep the app build type-safe at the boundary until
// the dependency is upgraded to a typed release.
declare module "gsap" {
  export const gsap: any;
}

declare module "gsap/ScrollTrigger" {
  export const ScrollTrigger: any;
}
