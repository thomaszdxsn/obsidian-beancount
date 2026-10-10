
import { AbstractParseTreeVisitor } from "antlr4ng";


import { BeancountFileContext } from "./BeancountParser.js";
import { DirectiveContext } from "./BeancountParser.js";
import { EolContext } from "./BeancountParser.js";
import { TransactionContext } from "./BeancountParser.js";
import { Txn_flagContext } from "./BeancountParser.js";
import { FlagContext } from "./BeancountParser.js";
import { Txn_stringsContext } from "./BeancountParser.js";
import { Tags_linksContext } from "./BeancountParser.js";
import { Tags_links_lineContext } from "./BeancountParser.js";
import { PostingContext } from "./BeancountParser.js";
import { Incomplete_amountContext } from "./BeancountParser.js";
import { AmountContext } from "./BeancountParser.js";
import { NumberContext } from "./BeancountParser.js";
import { CommodityContext } from "./BeancountParser.js";
import { CostContext } from "./BeancountParser.js";
import { Cost_comp_listContext } from "./BeancountParser.js";
import { Cost_compContext } from "./BeancountParser.js";
import { Compound_amountContext } from "./BeancountParser.js";
import { Price_annotationContext } from "./BeancountParser.js";
import { MetadataContext } from "./BeancountParser.js";
import { Key_value_lineContext } from "./BeancountParser.js";
import { Key_valueContext } from "./BeancountParser.js";
import { Key_value_valueContext } from "./BeancountParser.js";
import { PriceContext } from "./BeancountParser.js";
import { BalanceContext } from "./BeancountParser.js";
import { OpenContext } from "./BeancountParser.js";
import { BookingContext } from "./BeancountParser.js";
import { CloseContext } from "./BeancountParser.js";
import { Commodity_directiveContext } from "./BeancountParser.js";
import { PadContext } from "./BeancountParser.js";
import { NoteContext } from "./BeancountParser.js";
import { DocumentContext } from "./BeancountParser.js";
import { EventContext } from "./BeancountParser.js";
import { QueryContext } from "./BeancountParser.js";
import { CustomContext } from "./BeancountParser.js";
import { Custom_valueContext } from "./BeancountParser.js";
import { OptionsContext } from "./BeancountParser.js";
import { PluginContext } from "./BeancountParser.js";
import { IncludeContext } from "./BeancountParser.js";
import { PushtagContext } from "./BeancountParser.js";
import { PoptagContext } from "./BeancountParser.js";
import { PushmetaContext } from "./BeancountParser.js";
import { PopmetaContext } from "./BeancountParser.js";
import { AccountContext } from "./BeancountParser.js";


/**
 * This interface defines a complete generic visitor for a parse tree produced
 * by `BeancountParser`.
 *
 * @param <Result> The return type of the visit operation. Use `void` for
 * operations with no return type.
 */
export class BeancountVisitor<Result> extends AbstractParseTreeVisitor<Result> {
    /**
     * Visit a parse tree produced by `BeancountParser.beancountFile`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitBeancountFile?: (ctx: BeancountFileContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.directive`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitDirective?: (ctx: DirectiveContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.eol`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitEol?: (ctx: EolContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.transaction`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitTransaction?: (ctx: TransactionContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.txn_flag`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitTxn_flag?: (ctx: Txn_flagContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.flag`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitFlag?: (ctx: FlagContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.txn_strings`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitTxn_strings?: (ctx: Txn_stringsContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.tags_links`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitTags_links?: (ctx: Tags_linksContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.tags_links_line`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitTags_links_line?: (ctx: Tags_links_lineContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.posting`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitPosting?: (ctx: PostingContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.incomplete_amount`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitIncomplete_amount?: (ctx: Incomplete_amountContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.amount`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitAmount?: (ctx: AmountContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.number`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitNumber?: (ctx: NumberContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.commodity`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitCommodity?: (ctx: CommodityContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.cost`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitCost?: (ctx: CostContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.cost_comp_list`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitCost_comp_list?: (ctx: Cost_comp_listContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.cost_comp`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitCost_comp?: (ctx: Cost_compContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.compound_amount`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitCompound_amount?: (ctx: Compound_amountContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.price_annotation`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitPrice_annotation?: (ctx: Price_annotationContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.metadata`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitMetadata?: (ctx: MetadataContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.key_value_line`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitKey_value_line?: (ctx: Key_value_lineContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.key_value`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitKey_value?: (ctx: Key_valueContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.key_value_value`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitKey_value_value?: (ctx: Key_value_valueContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.price`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitPrice?: (ctx: PriceContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.balance`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitBalance?: (ctx: BalanceContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.open`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitOpen?: (ctx: OpenContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.booking`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitBooking?: (ctx: BookingContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.close`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitClose?: (ctx: CloseContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.commodity_directive`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitCommodity_directive?: (ctx: Commodity_directiveContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.pad`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitPad?: (ctx: PadContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.note`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitNote?: (ctx: NoteContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.document`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitDocument?: (ctx: DocumentContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.event`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitEvent?: (ctx: EventContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.query`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitQuery?: (ctx: QueryContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.custom`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitCustom?: (ctx: CustomContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.custom_value`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitCustom_value?: (ctx: Custom_valueContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.options`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitOptions?: (ctx: OptionsContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.plugin`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitPlugin?: (ctx: PluginContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.include`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitInclude?: (ctx: IncludeContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.pushtag`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitPushtag?: (ctx: PushtagContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.poptag`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitPoptag?: (ctx: PoptagContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.pushmeta`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitPushmeta?: (ctx: PushmetaContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.popmeta`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitPopmeta?: (ctx: PopmetaContext) => Result;
    /**
     * Visit a parse tree produced by `BeancountParser.account`.
     * @param ctx the parse tree
     * @return the visitor result
     */
    visitAccount?: (ctx: AccountContext) => Result;
}

