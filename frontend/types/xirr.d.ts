declare module "xirr" {
  interface XirrInput {
    amount: number;
    when: Date;
  }

  export default function xirr(
    cashflows: XirrInput[],
    guess?: number
  ): number;
}
