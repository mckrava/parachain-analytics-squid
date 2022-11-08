import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, Index as Index_} from "typeorm"
import * as marshal from "./marshal"

@Entity_()
export class Totals {
  constructor(props?: Partial<Totals>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
  finalizedBlocks!: bigint

  @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
  totalIssuance!: bigint

  @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
  signedExtrinsics!: bigint

  @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
  transfersCount!: bigint

  @Column_("int4", {nullable: false})
  holders!: number

  @Column_("int4", {nullable: false})
  validatorsIdealCount!: number

  @Column_("int4", {nullable: false})
  validatorsCount!: number

  @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
  stakedValueTotal!: bigint

  @Index_()
  @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: true})
  stakedValueValidator!: bigint | undefined | null

  @Index_()
  @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: true})
  stakedValueNominator!: bigint | undefined | null

  @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
  inflationRate!: bigint
}
