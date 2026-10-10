
import * as antlr from "antlr4ng";
import { Token } from "antlr4ng";

import { BeancountVisitor } from "./BeancountVisitor.js";

// for running tests with parameters, TODO: discuss strategy for typed parameters in CI
// eslint-disable-next-line no-unused-vars
type int = number;


export class BeancountParser extends antlr.Parser {
    public static readonly T__0 = 1;
    public static readonly T__1 = 2;
    public static readonly T__2 = 3;
    public static readonly T__3 = 4;
    public static readonly T__4 = 5;
    public static readonly T__5 = 6;
    public static readonly T__6 = 7;
    public static readonly T__7 = 8;
    public static readonly T__8 = 9;
    public static readonly T__9 = 10;
    public static readonly T__10 = 11;
    public static readonly T__11 = 12;
    public static readonly T__12 = 13;
    public static readonly T__13 = 14;
    public static readonly T__14 = 15;
    public static readonly T__15 = 16;
    public static readonly T__16 = 17;
    public static readonly T__17 = 18;
    public static readonly T__18 = 19;
    public static readonly T__19 = 20;
    public static readonly T__20 = 21;
    public static readonly TXN = 22;
    public static readonly FLAG = 23;
    public static readonly DATE = 24;
    public static readonly NUMBER = 25;
    public static readonly ACCOUNT = 26;
    public static readonly COMMODITY = 27;
    public static readonly TAG = 28;
    public static readonly LINK = 29;
    public static readonly TAG_KEY = 30;
    public static readonly AT = 31;
    public static readonly INDENT = 32;
    public static readonly STRING = 33;
    public static readonly COMMENT = 34;
    public static readonly WS = 35;
    public static readonly RULE_beancountFile = 0;
    public static readonly RULE_directive = 1;
    public static readonly RULE_transaction = 2;
    public static readonly RULE_txn_flag = 3;
    public static readonly RULE_posting = 4;
    public static readonly RULE_amount = 5;
    public static readonly RULE_number = 6;
    public static readonly RULE_commodity = 7;
    public static readonly RULE_cost = 8;
    public static readonly RULE_price_annotation = 9;
    public static readonly RULE_metadata = 10;
    public static readonly RULE_price = 11;
    public static readonly RULE_balance = 12;
    public static readonly RULE_open = 13;
    public static readonly RULE_booking = 14;
    public static readonly RULE_close = 15;
    public static readonly RULE_commodity_directive = 16;
    public static readonly RULE_pad = 17;
    public static readonly RULE_note = 18;
    public static readonly RULE_document = 19;
    public static readonly RULE_event = 20;
    public static readonly RULE_query = 21;
    public static readonly RULE_custom = 22;
    public static readonly RULE_options = 23;
    public static readonly RULE_plugin = 24;
    public static readonly RULE_include = 25;
    public static readonly RULE_account = 26;

    public static readonly literalNames = [
        null, "'{'", "','", "'}'", "'{{'", "'}}'", "'('", "')'", "'price'", 
        "'balance'", "'open'", "'close'", "'commodity'", "'pad'", "'note'", 
        "'document'", "'event'", "'query'", "'custom'", "'option'", "'plugin'", 
        "'include'", "'txn'", null, null, null, null, null, null, null, 
        null, "'@'", "'  '"
    ];

    public static readonly symbolicNames = [
        null, null, null, null, null, null, null, null, null, null, null, 
        null, null, null, null, null, null, null, null, null, null, null, 
        "TXN", "FLAG", "DATE", "NUMBER", "ACCOUNT", "COMMODITY", "TAG", 
        "LINK", "TAG_KEY", "AT", "INDENT", "STRING", "COMMENT", "WS"
    ];
    public static readonly ruleNames = [
        "beancountFile", "directive", "transaction", "txn_flag", "posting", 
        "amount", "number", "commodity", "cost", "price_annotation", "metadata", 
        "price", "balance", "open", "booking", "close", "commodity_directive", 
        "pad", "note", "document", "event", "query", "custom", "options", 
        "plugin", "include", "account",
    ];

    public get grammarFileName(): string { return "Beancount.g4"; }
    public get literalNames(): (string | null)[] { return BeancountParser.literalNames; }
    public get symbolicNames(): (string | null)[] { return BeancountParser.symbolicNames; }
    public get ruleNames(): string[] { return BeancountParser.ruleNames; }
    public get serializedATN(): number[] { return BeancountParser._serializedATN; }

    protected createFailedPredicateException(predicate?: string, message?: string): antlr.FailedPredicateException {
        return new antlr.FailedPredicateException(this, predicate, message);
    }

    public constructor(input: antlr.TokenStream) {
        super(input);
        this.interpreter = new antlr.ParserATNSimulator(this, BeancountParser._ATN, BeancountParser.decisionsToDFA, new antlr.PredictionContextCache());
    }
    public beancountFile(): BeancountFileContext {
        let localContext = new BeancountFileContext(this.context, this.state);
        this.enterRule(localContext, 0, BeancountParser.RULE_beancountFile);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 57;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            while (((((_la - 19)) & ~0x1F) === 0 && ((1 << (_la - 19)) & 32807) !== 0)) {
                {
                {
                this.state = 54;
                this.directive();
                }
                }
                this.state = 59;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
            }
            this.state = 60;
            this.match(BeancountParser.EOF);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public directive(): DirectiveContext {
        let localContext = new DirectiveContext(this.context, this.state);
        this.enterRule(localContext, 2, BeancountParser.RULE_directive);
        try {
            this.state = 78;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 1, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 62;
                this.transaction();
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 63;
                this.price();
                }
                break;
            case 3:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 64;
                this.balance();
                }
                break;
            case 4:
                this.enterOuterAlt(localContext, 4);
                {
                this.state = 65;
                this.open();
                }
                break;
            case 5:
                this.enterOuterAlt(localContext, 5);
                {
                this.state = 66;
                this.close();
                }
                break;
            case 6:
                this.enterOuterAlt(localContext, 6);
                {
                this.state = 67;
                this.commodity_directive();
                }
                break;
            case 7:
                this.enterOuterAlt(localContext, 7);
                {
                this.state = 68;
                this.pad();
                }
                break;
            case 8:
                this.enterOuterAlt(localContext, 8);
                {
                this.state = 69;
                this.note();
                }
                break;
            case 9:
                this.enterOuterAlt(localContext, 9);
                {
                this.state = 70;
                this.document();
                }
                break;
            case 10:
                this.enterOuterAlt(localContext, 10);
                {
                this.state = 71;
                this.event();
                }
                break;
            case 11:
                this.enterOuterAlt(localContext, 11);
                {
                this.state = 72;
                this.query();
                }
                break;
            case 12:
                this.enterOuterAlt(localContext, 12);
                {
                this.state = 73;
                this.custom();
                }
                break;
            case 13:
                this.enterOuterAlt(localContext, 13);
                {
                this.state = 74;
                this.options();
                }
                break;
            case 14:
                this.enterOuterAlt(localContext, 14);
                {
                this.state = 75;
                this.plugin();
                }
                break;
            case 15:
                this.enterOuterAlt(localContext, 15);
                {
                this.state = 76;
                this.include();
                }
                break;
            case 16:
                this.enterOuterAlt(localContext, 16);
                {
                this.state = 77;
                this.match(BeancountParser.COMMENT);
                }
                break;
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public transaction(): TransactionContext {
        let localContext = new TransactionContext(this.context, this.state);
        this.enterRule(localContext, 4, BeancountParser.RULE_transaction);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 80;
            this.match(BeancountParser.DATE);
            this.state = 82;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 22 || _la === 23) {
                {
                this.state = 81;
                this.txn_flag();
                }
            }

            this.state = 88;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 33) {
                {
                this.state = 84;
                this.match(BeancountParser.STRING);
                this.state = 86;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 33) {
                    {
                    this.state = 85;
                    this.match(BeancountParser.STRING);
                    }
                }

                }
            }

            this.state = 93;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            while (_la === 32) {
                {
                {
                this.state = 90;
                this.posting();
                }
                }
                this.state = 95;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public txn_flag(): Txn_flagContext {
        let localContext = new Txn_flagContext(this.context, this.state);
        this.enterRule(localContext, 6, BeancountParser.RULE_txn_flag);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 96;
            _la = this.tokenStream.LA(1);
            if(!(_la === 22 || _la === 23)) {
            this.errorHandler.recoverInline(this);
            }
            else {
                this.errorHandler.reportMatch(this);
                this.consume();
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public posting(): PostingContext {
        let localContext = new PostingContext(this.context, this.state);
        this.enterRule(localContext, 8, BeancountParser.RULE_posting);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 98;
            this.match(BeancountParser.INDENT);
            this.state = 99;
            this.account();
            this.state = 101;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 25) {
                {
                this.state = 100;
                this.amount();
                }
            }

            this.state = 104;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 1 || _la === 4) {
                {
                this.state = 103;
                this.cost();
                }
            }

            this.state = 107;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 31) {
                {
                this.state = 106;
                this.price_annotation();
                }
            }

            this.state = 110;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 9, this.context) ) {
            case 1:
                {
                this.state = 109;
                this.metadata();
                }
                break;
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public amount(): AmountContext {
        let localContext = new AmountContext(this.context, this.state);
        this.enterRule(localContext, 10, BeancountParser.RULE_amount);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 112;
            this.number_();
            this.state = 113;
            this.commodity();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public number_(): NumberContext {
        let localContext = new NumberContext(this.context, this.state);
        this.enterRule(localContext, 12, BeancountParser.RULE_number);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 115;
            this.match(BeancountParser.NUMBER);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public commodity(): CommodityContext {
        let localContext = new CommodityContext(this.context, this.state);
        this.enterRule(localContext, 14, BeancountParser.RULE_commodity);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 117;
            this.match(BeancountParser.COMMODITY);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public cost(): CostContext {
        let localContext = new CostContext(this.context, this.state);
        this.enterRule(localContext, 16, BeancountParser.RULE_cost);
        let _la: number;
        try {
            this.state = 136;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case BeancountParser.T__0:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 119;
                this.match(BeancountParser.T__0);
                this.state = 121;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 25) {
                    {
                    this.state = 120;
                    this.amount();
                    }
                }

                this.state = 127;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                while (_la === 2) {
                    {
                    {
                    this.state = 123;
                    this.match(BeancountParser.T__1);
                    this.state = 124;
                    _la = this.tokenStream.LA(1);
                    if(!(_la === 24 || _la === 33)) {
                    this.errorHandler.recoverInline(this);
                    }
                    else {
                        this.errorHandler.reportMatch(this);
                        this.consume();
                    }
                    }
                    }
                    this.state = 129;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                }
                this.state = 130;
                this.match(BeancountParser.T__2);
                }
                break;
            case BeancountParser.T__3:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 131;
                this.match(BeancountParser.T__3);
                this.state = 133;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 25) {
                    {
                    this.state = 132;
                    this.amount();
                    }
                }

                this.state = 135;
                this.match(BeancountParser.T__4);
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public price_annotation(): Price_annotationContext {
        let localContext = new Price_annotationContext(this.context, this.state);
        this.enterRule(localContext, 18, BeancountParser.RULE_price_annotation);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 138;
            this.match(BeancountParser.AT);
            this.state = 144;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case BeancountParser.NUMBER:
                {
                this.state = 139;
                this.amount();
                }
                break;
            case BeancountParser.T__5:
                {
                {
                this.state = 140;
                this.match(BeancountParser.T__5);
                this.state = 141;
                this.amount();
                this.state = 142;
                this.match(BeancountParser.T__6);
                }
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public metadata(): MetadataContext {
        let localContext = new MetadataContext(this.context, this.state);
        this.enterRule(localContext, 20, BeancountParser.RULE_metadata);
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 155;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 16, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 146;
                    this.match(BeancountParser.INDENT);
                    this.state = 147;
                    this.match(BeancountParser.TAG_KEY);
                    this.state = 151;
                    this.errorHandler.sync(this);
                    switch (this.tokenStream.LA(1)) {
                    case BeancountParser.STRING:
                        {
                        this.state = 148;
                        this.match(BeancountParser.STRING);
                        }
                        break;
                    case BeancountParser.DATE:
                        {
                        this.state = 149;
                        this.match(BeancountParser.DATE);
                        }
                        break;
                    case BeancountParser.NUMBER:
                        {
                        this.state = 150;
                        this.number_();
                        }
                        break;
                    default:
                        throw new antlr.NoViableAltException(this);
                    }
                    }
                    }
                }
                this.state = 157;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 16, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public price(): PriceContext {
        let localContext = new PriceContext(this.context, this.state);
        this.enterRule(localContext, 22, BeancountParser.RULE_price);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 158;
            this.match(BeancountParser.DATE);
            this.state = 159;
            this.match(BeancountParser.T__7);
            this.state = 160;
            this.commodity();
            this.state = 161;
            this.amount();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public balance(): BalanceContext {
        let localContext = new BalanceContext(this.context, this.state);
        this.enterRule(localContext, 24, BeancountParser.RULE_balance);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 163;
            this.match(BeancountParser.DATE);
            this.state = 164;
            this.match(BeancountParser.T__8);
            this.state = 165;
            this.account();
            this.state = 166;
            this.amount();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public open(): OpenContext {
        let localContext = new OpenContext(this.context, this.state);
        this.enterRule(localContext, 26, BeancountParser.RULE_open);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 168;
            this.match(BeancountParser.DATE);
            this.state = 169;
            this.match(BeancountParser.T__9);
            this.state = 170;
            this.account();
            this.state = 179;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 27) {
                {
                this.state = 171;
                this.commodity();
                this.state = 176;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                while (_la === 2) {
                    {
                    {
                    this.state = 172;
                    this.match(BeancountParser.T__1);
                    this.state = 173;
                    this.commodity();
                    }
                    }
                    this.state = 178;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                }
                }
            }

            this.state = 182;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 33) {
                {
                this.state = 181;
                this.booking();
                }
            }

            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public booking(): BookingContext {
        let localContext = new BookingContext(this.context, this.state);
        this.enterRule(localContext, 28, BeancountParser.RULE_booking);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 184;
            this.match(BeancountParser.STRING);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public close(): CloseContext {
        let localContext = new CloseContext(this.context, this.state);
        this.enterRule(localContext, 30, BeancountParser.RULE_close);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 186;
            this.match(BeancountParser.DATE);
            this.state = 187;
            this.match(BeancountParser.T__10);
            this.state = 188;
            this.account();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public commodity_directive(): Commodity_directiveContext {
        let localContext = new Commodity_directiveContext(this.context, this.state);
        this.enterRule(localContext, 32, BeancountParser.RULE_commodity_directive);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 190;
            this.match(BeancountParser.DATE);
            this.state = 191;
            this.match(BeancountParser.T__11);
            this.state = 192;
            this.match(BeancountParser.COMMODITY);
            this.state = 194;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 20, this.context) ) {
            case 1:
                {
                this.state = 193;
                this.metadata();
                }
                break;
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public pad(): PadContext {
        let localContext = new PadContext(this.context, this.state);
        this.enterRule(localContext, 34, BeancountParser.RULE_pad);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 196;
            this.match(BeancountParser.DATE);
            this.state = 197;
            this.match(BeancountParser.T__12);
            this.state = 198;
            this.account();
            this.state = 199;
            this.account();
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public note(): NoteContext {
        let localContext = new NoteContext(this.context, this.state);
        this.enterRule(localContext, 36, BeancountParser.RULE_note);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 201;
            this.match(BeancountParser.DATE);
            this.state = 202;
            this.match(BeancountParser.T__13);
            this.state = 203;
            this.account();
            this.state = 204;
            this.match(BeancountParser.STRING);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public document(): DocumentContext {
        let localContext = new DocumentContext(this.context, this.state);
        this.enterRule(localContext, 38, BeancountParser.RULE_document);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 206;
            this.match(BeancountParser.DATE);
            this.state = 207;
            this.match(BeancountParser.T__14);
            this.state = 208;
            this.account();
            this.state = 209;
            this.match(BeancountParser.STRING);
            this.state = 211;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 21, this.context) ) {
            case 1:
                {
                this.state = 210;
                this.metadata();
                }
                break;
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public event(): EventContext {
        let localContext = new EventContext(this.context, this.state);
        this.enterRule(localContext, 40, BeancountParser.RULE_event);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 213;
            this.match(BeancountParser.DATE);
            this.state = 214;
            this.match(BeancountParser.T__15);
            this.state = 215;
            this.match(BeancountParser.STRING);
            this.state = 216;
            this.match(BeancountParser.STRING);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public query(): QueryContext {
        let localContext = new QueryContext(this.context, this.state);
        this.enterRule(localContext, 42, BeancountParser.RULE_query);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 218;
            this.match(BeancountParser.DATE);
            this.state = 219;
            this.match(BeancountParser.T__16);
            this.state = 220;
            this.match(BeancountParser.STRING);
            this.state = 221;
            this.match(BeancountParser.STRING);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public custom(): CustomContext {
        let localContext = new CustomContext(this.context, this.state);
        this.enterRule(localContext, 44, BeancountParser.RULE_custom);
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 223;
            this.match(BeancountParser.DATE);
            this.state = 224;
            this.match(BeancountParser.T__17);
            this.state = 225;
            this.match(BeancountParser.STRING);
            this.state = 235;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 23, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    this.state = 233;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 22, this.context) ) {
                    case 1:
                        {
                        this.state = 226;
                        this.match(BeancountParser.STRING);
                        }
                        break;
                    case 2:
                        {
                        this.state = 227;
                        this.match(BeancountParser.DATE);
                        }
                        break;
                    case 3:
                        {
                        this.state = 228;
                        this.number_();
                        }
                        break;
                    case 4:
                        {
                        this.state = 229;
                        this.amount();
                        }
                        break;
                    case 5:
                        {
                        this.state = 230;
                        this.account();
                        }
                        break;
                    case 6:
                        {
                        this.state = 231;
                        this.match(BeancountParser.TAG);
                        }
                        break;
                    case 7:
                        {
                        this.state = 232;
                        this.match(BeancountParser.LINK);
                        }
                        break;
                    }
                    }
                }
                this.state = 237;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 23, this.context);
            }
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public options(): OptionsContext {
        let localContext = new OptionsContext(this.context, this.state);
        this.enterRule(localContext, 46, BeancountParser.RULE_options);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 238;
            this.match(BeancountParser.T__18);
            this.state = 239;
            this.match(BeancountParser.STRING);
            this.state = 240;
            this.match(BeancountParser.STRING);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public plugin(): PluginContext {
        let localContext = new PluginContext(this.context, this.state);
        this.enterRule(localContext, 48, BeancountParser.RULE_plugin);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 242;
            this.match(BeancountParser.T__19);
            this.state = 243;
            this.match(BeancountParser.STRING);
            this.state = 245;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 33) {
                {
                this.state = 244;
                this.match(BeancountParser.STRING);
                }
            }

            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public include(): IncludeContext {
        let localContext = new IncludeContext(this.context, this.state);
        this.enterRule(localContext, 50, BeancountParser.RULE_include);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 247;
            this.match(BeancountParser.T__20);
            this.state = 248;
            this.match(BeancountParser.STRING);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }
    public account(): AccountContext {
        let localContext = new AccountContext(this.context, this.state);
        this.enterRule(localContext, 52, BeancountParser.RULE_account);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 250;
            this.match(BeancountParser.ACCOUNT);
            }
        }
        catch (re) {
            if (re instanceof antlr.RecognitionException) {
                this.errorHandler.reportError(this, re);
                this.errorHandler.recover(this, re);
            } else {
                throw re;
            }
        }
        finally {
            this.exitRule();
        }
        return localContext;
    }

    public static readonly _serializedATN: number[] = [
        4,1,35,253,2,0,7,0,2,1,7,1,2,2,7,2,2,3,7,3,2,4,7,4,2,5,7,5,2,6,7,
        6,2,7,7,7,2,8,7,8,2,9,7,9,2,10,7,10,2,11,7,11,2,12,7,12,2,13,7,13,
        2,14,7,14,2,15,7,15,2,16,7,16,2,17,7,17,2,18,7,18,2,19,7,19,2,20,
        7,20,2,21,7,21,2,22,7,22,2,23,7,23,2,24,7,24,2,25,7,25,2,26,7,26,
        1,0,5,0,56,8,0,10,0,12,0,59,9,0,1,0,1,0,1,1,1,1,1,1,1,1,1,1,1,1,
        1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,3,1,79,8,1,1,2,1,2,3,2,83,
        8,2,1,2,1,2,3,2,87,8,2,3,2,89,8,2,1,2,5,2,92,8,2,10,2,12,2,95,9,
        2,1,3,1,3,1,4,1,4,1,4,3,4,102,8,4,1,4,3,4,105,8,4,1,4,3,4,108,8,
        4,1,4,3,4,111,8,4,1,5,1,5,1,5,1,6,1,6,1,7,1,7,1,8,1,8,3,8,122,8,
        8,1,8,1,8,5,8,126,8,8,10,8,12,8,129,9,8,1,8,1,8,1,8,3,8,134,8,8,
        1,8,3,8,137,8,8,1,9,1,9,1,9,1,9,1,9,1,9,3,9,145,8,9,1,10,1,10,1,
        10,1,10,1,10,3,10,152,8,10,5,10,154,8,10,10,10,12,10,157,9,10,1,
        11,1,11,1,11,1,11,1,11,1,12,1,12,1,12,1,12,1,12,1,13,1,13,1,13,1,
        13,1,13,1,13,5,13,175,8,13,10,13,12,13,178,9,13,3,13,180,8,13,1,
        13,3,13,183,8,13,1,14,1,14,1,15,1,15,1,15,1,15,1,16,1,16,1,16,1,
        16,3,16,195,8,16,1,17,1,17,1,17,1,17,1,17,1,18,1,18,1,18,1,18,1,
        18,1,19,1,19,1,19,1,19,1,19,3,19,212,8,19,1,20,1,20,1,20,1,20,1,
        20,1,21,1,21,1,21,1,21,1,21,1,22,1,22,1,22,1,22,1,22,1,22,1,22,1,
        22,1,22,1,22,5,22,234,8,22,10,22,12,22,237,9,22,1,23,1,23,1,23,1,
        23,1,24,1,24,1,24,3,24,246,8,24,1,25,1,25,1,25,1,26,1,26,1,26,0,
        0,27,0,2,4,6,8,10,12,14,16,18,20,22,24,26,28,30,32,34,36,38,40,42,
        44,46,48,50,52,0,2,1,0,22,23,2,0,24,24,33,33,270,0,57,1,0,0,0,2,
        78,1,0,0,0,4,80,1,0,0,0,6,96,1,0,0,0,8,98,1,0,0,0,10,112,1,0,0,0,
        12,115,1,0,0,0,14,117,1,0,0,0,16,136,1,0,0,0,18,138,1,0,0,0,20,155,
        1,0,0,0,22,158,1,0,0,0,24,163,1,0,0,0,26,168,1,0,0,0,28,184,1,0,
        0,0,30,186,1,0,0,0,32,190,1,0,0,0,34,196,1,0,0,0,36,201,1,0,0,0,
        38,206,1,0,0,0,40,213,1,0,0,0,42,218,1,0,0,0,44,223,1,0,0,0,46,238,
        1,0,0,0,48,242,1,0,0,0,50,247,1,0,0,0,52,250,1,0,0,0,54,56,3,2,1,
        0,55,54,1,0,0,0,56,59,1,0,0,0,57,55,1,0,0,0,57,58,1,0,0,0,58,60,
        1,0,0,0,59,57,1,0,0,0,60,61,5,0,0,1,61,1,1,0,0,0,62,79,3,4,2,0,63,
        79,3,22,11,0,64,79,3,24,12,0,65,79,3,26,13,0,66,79,3,30,15,0,67,
        79,3,32,16,0,68,79,3,34,17,0,69,79,3,36,18,0,70,79,3,38,19,0,71,
        79,3,40,20,0,72,79,3,42,21,0,73,79,3,44,22,0,74,79,3,46,23,0,75,
        79,3,48,24,0,76,79,3,50,25,0,77,79,5,34,0,0,78,62,1,0,0,0,78,63,
        1,0,0,0,78,64,1,0,0,0,78,65,1,0,0,0,78,66,1,0,0,0,78,67,1,0,0,0,
        78,68,1,0,0,0,78,69,1,0,0,0,78,70,1,0,0,0,78,71,1,0,0,0,78,72,1,
        0,0,0,78,73,1,0,0,0,78,74,1,0,0,0,78,75,1,0,0,0,78,76,1,0,0,0,78,
        77,1,0,0,0,79,3,1,0,0,0,80,82,5,24,0,0,81,83,3,6,3,0,82,81,1,0,0,
        0,82,83,1,0,0,0,83,88,1,0,0,0,84,86,5,33,0,0,85,87,5,33,0,0,86,85,
        1,0,0,0,86,87,1,0,0,0,87,89,1,0,0,0,88,84,1,0,0,0,88,89,1,0,0,0,
        89,93,1,0,0,0,90,92,3,8,4,0,91,90,1,0,0,0,92,95,1,0,0,0,93,91,1,
        0,0,0,93,94,1,0,0,0,94,5,1,0,0,0,95,93,1,0,0,0,96,97,7,0,0,0,97,
        7,1,0,0,0,98,99,5,32,0,0,99,101,3,52,26,0,100,102,3,10,5,0,101,100,
        1,0,0,0,101,102,1,0,0,0,102,104,1,0,0,0,103,105,3,16,8,0,104,103,
        1,0,0,0,104,105,1,0,0,0,105,107,1,0,0,0,106,108,3,18,9,0,107,106,
        1,0,0,0,107,108,1,0,0,0,108,110,1,0,0,0,109,111,3,20,10,0,110,109,
        1,0,0,0,110,111,1,0,0,0,111,9,1,0,0,0,112,113,3,12,6,0,113,114,3,
        14,7,0,114,11,1,0,0,0,115,116,5,25,0,0,116,13,1,0,0,0,117,118,5,
        27,0,0,118,15,1,0,0,0,119,121,5,1,0,0,120,122,3,10,5,0,121,120,1,
        0,0,0,121,122,1,0,0,0,122,127,1,0,0,0,123,124,5,2,0,0,124,126,7,
        1,0,0,125,123,1,0,0,0,126,129,1,0,0,0,127,125,1,0,0,0,127,128,1,
        0,0,0,128,130,1,0,0,0,129,127,1,0,0,0,130,137,5,3,0,0,131,133,5,
        4,0,0,132,134,3,10,5,0,133,132,1,0,0,0,133,134,1,0,0,0,134,135,1,
        0,0,0,135,137,5,5,0,0,136,119,1,0,0,0,136,131,1,0,0,0,137,17,1,0,
        0,0,138,144,5,31,0,0,139,145,3,10,5,0,140,141,5,6,0,0,141,142,3,
        10,5,0,142,143,5,7,0,0,143,145,1,0,0,0,144,139,1,0,0,0,144,140,1,
        0,0,0,145,19,1,0,0,0,146,147,5,32,0,0,147,151,5,30,0,0,148,152,5,
        33,0,0,149,152,5,24,0,0,150,152,3,12,6,0,151,148,1,0,0,0,151,149,
        1,0,0,0,151,150,1,0,0,0,152,154,1,0,0,0,153,146,1,0,0,0,154,157,
        1,0,0,0,155,153,1,0,0,0,155,156,1,0,0,0,156,21,1,0,0,0,157,155,1,
        0,0,0,158,159,5,24,0,0,159,160,5,8,0,0,160,161,3,14,7,0,161,162,
        3,10,5,0,162,23,1,0,0,0,163,164,5,24,0,0,164,165,5,9,0,0,165,166,
        3,52,26,0,166,167,3,10,5,0,167,25,1,0,0,0,168,169,5,24,0,0,169,170,
        5,10,0,0,170,179,3,52,26,0,171,176,3,14,7,0,172,173,5,2,0,0,173,
        175,3,14,7,0,174,172,1,0,0,0,175,178,1,0,0,0,176,174,1,0,0,0,176,
        177,1,0,0,0,177,180,1,0,0,0,178,176,1,0,0,0,179,171,1,0,0,0,179,
        180,1,0,0,0,180,182,1,0,0,0,181,183,3,28,14,0,182,181,1,0,0,0,182,
        183,1,0,0,0,183,27,1,0,0,0,184,185,5,33,0,0,185,29,1,0,0,0,186,187,
        5,24,0,0,187,188,5,11,0,0,188,189,3,52,26,0,189,31,1,0,0,0,190,191,
        5,24,0,0,191,192,5,12,0,0,192,194,5,27,0,0,193,195,3,20,10,0,194,
        193,1,0,0,0,194,195,1,0,0,0,195,33,1,0,0,0,196,197,5,24,0,0,197,
        198,5,13,0,0,198,199,3,52,26,0,199,200,3,52,26,0,200,35,1,0,0,0,
        201,202,5,24,0,0,202,203,5,14,0,0,203,204,3,52,26,0,204,205,5,33,
        0,0,205,37,1,0,0,0,206,207,5,24,0,0,207,208,5,15,0,0,208,209,3,52,
        26,0,209,211,5,33,0,0,210,212,3,20,10,0,211,210,1,0,0,0,211,212,
        1,0,0,0,212,39,1,0,0,0,213,214,5,24,0,0,214,215,5,16,0,0,215,216,
        5,33,0,0,216,217,5,33,0,0,217,41,1,0,0,0,218,219,5,24,0,0,219,220,
        5,17,0,0,220,221,5,33,0,0,221,222,5,33,0,0,222,43,1,0,0,0,223,224,
        5,24,0,0,224,225,5,18,0,0,225,235,5,33,0,0,226,234,5,33,0,0,227,
        234,5,24,0,0,228,234,3,12,6,0,229,234,3,10,5,0,230,234,3,52,26,0,
        231,234,5,28,0,0,232,234,5,29,0,0,233,226,1,0,0,0,233,227,1,0,0,
        0,233,228,1,0,0,0,233,229,1,0,0,0,233,230,1,0,0,0,233,231,1,0,0,
        0,233,232,1,0,0,0,234,237,1,0,0,0,235,233,1,0,0,0,235,236,1,0,0,
        0,236,45,1,0,0,0,237,235,1,0,0,0,238,239,5,19,0,0,239,240,5,33,0,
        0,240,241,5,33,0,0,241,47,1,0,0,0,242,243,5,20,0,0,243,245,5,33,
        0,0,244,246,5,33,0,0,245,244,1,0,0,0,245,246,1,0,0,0,246,49,1,0,
        0,0,247,248,5,21,0,0,248,249,5,33,0,0,249,51,1,0,0,0,250,251,5,26,
        0,0,251,53,1,0,0,0,25,57,78,82,86,88,93,101,104,107,110,121,127,
        133,136,144,151,155,176,179,182,194,211,233,235,245
    ];

    private static __ATN: antlr.ATN;
    public static get _ATN(): antlr.ATN {
        if (!BeancountParser.__ATN) {
            BeancountParser.__ATN = new antlr.ATNDeserializer().deserialize(BeancountParser._serializedATN);
        }

        return BeancountParser.__ATN;
    }


    private static readonly vocabulary = new antlr.Vocabulary(BeancountParser.literalNames, BeancountParser.symbolicNames, []);

    public override get vocabulary(): antlr.Vocabulary {
        return BeancountParser.vocabulary;
    }

    private static readonly decisionsToDFA = BeancountParser._ATN.decisionToState.map( (ds: antlr.DecisionState, index: number) => new antlr.DFA(ds, index) );
}

export class BeancountFileContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public EOF(): antlr.TerminalNode {
        return this.getToken(BeancountParser.EOF, 0)!;
    }
    public directive(): DirectiveContext[];
    public directive(i: number): DirectiveContext | null;
    public directive(i?: number): DirectiveContext[] | DirectiveContext | null {
        if (i === undefined) {
            return this.getRuleContexts(DirectiveContext);
        }

        return this.getRuleContext(i, DirectiveContext);
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_beancountFile;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitBeancountFile) {
            return visitor.visitBeancountFile(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class DirectiveContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public transaction(): TransactionContext | null {
        return this.getRuleContext(0, TransactionContext);
    }
    public price(): PriceContext | null {
        return this.getRuleContext(0, PriceContext);
    }
    public balance(): BalanceContext | null {
        return this.getRuleContext(0, BalanceContext);
    }
    public open(): OpenContext | null {
        return this.getRuleContext(0, OpenContext);
    }
    public close(): CloseContext | null {
        return this.getRuleContext(0, CloseContext);
    }
    public commodity_directive(): Commodity_directiveContext | null {
        return this.getRuleContext(0, Commodity_directiveContext);
    }
    public pad(): PadContext | null {
        return this.getRuleContext(0, PadContext);
    }
    public note(): NoteContext | null {
        return this.getRuleContext(0, NoteContext);
    }
    public document(): DocumentContext | null {
        return this.getRuleContext(0, DocumentContext);
    }
    public event(): EventContext | null {
        return this.getRuleContext(0, EventContext);
    }
    public query(): QueryContext | null {
        return this.getRuleContext(0, QueryContext);
    }
    public custom(): CustomContext | null {
        return this.getRuleContext(0, CustomContext);
    }
    public options(): OptionsContext | null {
        return this.getRuleContext(0, OptionsContext);
    }
    public plugin(): PluginContext | null {
        return this.getRuleContext(0, PluginContext);
    }
    public include(): IncludeContext | null {
        return this.getRuleContext(0, IncludeContext);
    }
    public COMMENT(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.COMMENT, 0);
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_directive;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitDirective) {
            return visitor.visitDirective(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class TransactionContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public DATE(): antlr.TerminalNode {
        return this.getToken(BeancountParser.DATE, 0)!;
    }
    public txn_flag(): Txn_flagContext | null {
        return this.getRuleContext(0, Txn_flagContext);
    }
    public STRING(): antlr.TerminalNode[];
    public STRING(i: number): antlr.TerminalNode | null;
    public STRING(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(BeancountParser.STRING);
    	} else {
    		return this.getToken(BeancountParser.STRING, i);
    	}
    }
    public posting(): PostingContext[];
    public posting(i: number): PostingContext | null;
    public posting(i?: number): PostingContext[] | PostingContext | null {
        if (i === undefined) {
            return this.getRuleContexts(PostingContext);
        }

        return this.getRuleContext(i, PostingContext);
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_transaction;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitTransaction) {
            return visitor.visitTransaction(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class Txn_flagContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public TXN(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.TXN, 0);
    }
    public FLAG(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.FLAG, 0);
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_txn_flag;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitTxn_flag) {
            return visitor.visitTxn_flag(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class PostingContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public INDENT(): antlr.TerminalNode {
        return this.getToken(BeancountParser.INDENT, 0)!;
    }
    public account(): AccountContext {
        return this.getRuleContext(0, AccountContext)!;
    }
    public amount(): AmountContext | null {
        return this.getRuleContext(0, AmountContext);
    }
    public cost(): CostContext | null {
        return this.getRuleContext(0, CostContext);
    }
    public price_annotation(): Price_annotationContext | null {
        return this.getRuleContext(0, Price_annotationContext);
    }
    public metadata(): MetadataContext | null {
        return this.getRuleContext(0, MetadataContext);
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_posting;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitPosting) {
            return visitor.visitPosting(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class AmountContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public number(): NumberContext {
        return this.getRuleContext(0, NumberContext)!;
    }
    public commodity(): CommodityContext {
        return this.getRuleContext(0, CommodityContext)!;
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_amount;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitAmount) {
            return visitor.visitAmount(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class NumberContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public NUMBER(): antlr.TerminalNode {
        return this.getToken(BeancountParser.NUMBER, 0)!;
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_number;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitNumber) {
            return visitor.visitNumber(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class CommodityContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public COMMODITY(): antlr.TerminalNode {
        return this.getToken(BeancountParser.COMMODITY, 0)!;
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_commodity;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitCommodity) {
            return visitor.visitCommodity(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class CostContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public amount(): AmountContext | null {
        return this.getRuleContext(0, AmountContext);
    }
    public DATE(): antlr.TerminalNode[];
    public DATE(i: number): antlr.TerminalNode | null;
    public DATE(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(BeancountParser.DATE);
    	} else {
    		return this.getToken(BeancountParser.DATE, i);
    	}
    }
    public STRING(): antlr.TerminalNode[];
    public STRING(i: number): antlr.TerminalNode | null;
    public STRING(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(BeancountParser.STRING);
    	} else {
    		return this.getToken(BeancountParser.STRING, i);
    	}
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_cost;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitCost) {
            return visitor.visitCost(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class Price_annotationContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public AT(): antlr.TerminalNode {
        return this.getToken(BeancountParser.AT, 0)!;
    }
    public amount(): AmountContext | null {
        return this.getRuleContext(0, AmountContext);
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_price_annotation;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitPrice_annotation) {
            return visitor.visitPrice_annotation(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class MetadataContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public INDENT(): antlr.TerminalNode[];
    public INDENT(i: number): antlr.TerminalNode | null;
    public INDENT(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(BeancountParser.INDENT);
    	} else {
    		return this.getToken(BeancountParser.INDENT, i);
    	}
    }
    public TAG_KEY(): antlr.TerminalNode[];
    public TAG_KEY(i: number): antlr.TerminalNode | null;
    public TAG_KEY(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(BeancountParser.TAG_KEY);
    	} else {
    		return this.getToken(BeancountParser.TAG_KEY, i);
    	}
    }
    public STRING(): antlr.TerminalNode[];
    public STRING(i: number): antlr.TerminalNode | null;
    public STRING(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(BeancountParser.STRING);
    	} else {
    		return this.getToken(BeancountParser.STRING, i);
    	}
    }
    public DATE(): antlr.TerminalNode[];
    public DATE(i: number): antlr.TerminalNode | null;
    public DATE(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(BeancountParser.DATE);
    	} else {
    		return this.getToken(BeancountParser.DATE, i);
    	}
    }
    public number_(): NumberContext[];
    public number_(i: number): NumberContext | null;
    public number_(i?: number): NumberContext[] | NumberContext | null {
        if (i === undefined) {
            return this.getRuleContexts(NumberContext);
        }

        return this.getRuleContext(i, NumberContext);
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_metadata;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitMetadata) {
            return visitor.visitMetadata(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class PriceContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public DATE(): antlr.TerminalNode {
        return this.getToken(BeancountParser.DATE, 0)!;
    }
    public commodity(): CommodityContext {
        return this.getRuleContext(0, CommodityContext)!;
    }
    public amount(): AmountContext {
        return this.getRuleContext(0, AmountContext)!;
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_price;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitPrice) {
            return visitor.visitPrice(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class BalanceContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public DATE(): antlr.TerminalNode {
        return this.getToken(BeancountParser.DATE, 0)!;
    }
    public account(): AccountContext {
        return this.getRuleContext(0, AccountContext)!;
    }
    public amount(): AmountContext {
        return this.getRuleContext(0, AmountContext)!;
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_balance;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitBalance) {
            return visitor.visitBalance(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class OpenContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public DATE(): antlr.TerminalNode {
        return this.getToken(BeancountParser.DATE, 0)!;
    }
    public account(): AccountContext {
        return this.getRuleContext(0, AccountContext)!;
    }
    public commodity(): CommodityContext[];
    public commodity(i: number): CommodityContext | null;
    public commodity(i?: number): CommodityContext[] | CommodityContext | null {
        if (i === undefined) {
            return this.getRuleContexts(CommodityContext);
        }

        return this.getRuleContext(i, CommodityContext);
    }
    public booking(): BookingContext | null {
        return this.getRuleContext(0, BookingContext);
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_open;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitOpen) {
            return visitor.visitOpen(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class BookingContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public STRING(): antlr.TerminalNode {
        return this.getToken(BeancountParser.STRING, 0)!;
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_booking;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitBooking) {
            return visitor.visitBooking(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class CloseContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public DATE(): antlr.TerminalNode {
        return this.getToken(BeancountParser.DATE, 0)!;
    }
    public account(): AccountContext {
        return this.getRuleContext(0, AccountContext)!;
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_close;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitClose) {
            return visitor.visitClose(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class Commodity_directiveContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public DATE(): antlr.TerminalNode {
        return this.getToken(BeancountParser.DATE, 0)!;
    }
    public COMMODITY(): antlr.TerminalNode {
        return this.getToken(BeancountParser.COMMODITY, 0)!;
    }
    public metadata(): MetadataContext | null {
        return this.getRuleContext(0, MetadataContext);
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_commodity_directive;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitCommodity_directive) {
            return visitor.visitCommodity_directive(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class PadContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public DATE(): antlr.TerminalNode {
        return this.getToken(BeancountParser.DATE, 0)!;
    }
    public account(): AccountContext[];
    public account(i: number): AccountContext | null;
    public account(i?: number): AccountContext[] | AccountContext | null {
        if (i === undefined) {
            return this.getRuleContexts(AccountContext);
        }

        return this.getRuleContext(i, AccountContext);
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_pad;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitPad) {
            return visitor.visitPad(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class NoteContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public DATE(): antlr.TerminalNode {
        return this.getToken(BeancountParser.DATE, 0)!;
    }
    public account(): AccountContext {
        return this.getRuleContext(0, AccountContext)!;
    }
    public STRING(): antlr.TerminalNode {
        return this.getToken(BeancountParser.STRING, 0)!;
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_note;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitNote) {
            return visitor.visitNote(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class DocumentContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public DATE(): antlr.TerminalNode {
        return this.getToken(BeancountParser.DATE, 0)!;
    }
    public account(): AccountContext {
        return this.getRuleContext(0, AccountContext)!;
    }
    public STRING(): antlr.TerminalNode {
        return this.getToken(BeancountParser.STRING, 0)!;
    }
    public metadata(): MetadataContext | null {
        return this.getRuleContext(0, MetadataContext);
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_document;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitDocument) {
            return visitor.visitDocument(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class EventContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public DATE(): antlr.TerminalNode {
        return this.getToken(BeancountParser.DATE, 0)!;
    }
    public STRING(): antlr.TerminalNode[];
    public STRING(i: number): antlr.TerminalNode | null;
    public STRING(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(BeancountParser.STRING);
    	} else {
    		return this.getToken(BeancountParser.STRING, i);
    	}
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_event;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitEvent) {
            return visitor.visitEvent(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class QueryContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public DATE(): antlr.TerminalNode {
        return this.getToken(BeancountParser.DATE, 0)!;
    }
    public STRING(): antlr.TerminalNode[];
    public STRING(i: number): antlr.TerminalNode | null;
    public STRING(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(BeancountParser.STRING);
    	} else {
    		return this.getToken(BeancountParser.STRING, i);
    	}
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_query;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitQuery) {
            return visitor.visitQuery(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class CustomContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public DATE(): antlr.TerminalNode[];
    public DATE(i: number): antlr.TerminalNode | null;
    public DATE(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(BeancountParser.DATE);
    	} else {
    		return this.getToken(BeancountParser.DATE, i);
    	}
    }
    public STRING(): antlr.TerminalNode[];
    public STRING(i: number): antlr.TerminalNode | null;
    public STRING(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(BeancountParser.STRING);
    	} else {
    		return this.getToken(BeancountParser.STRING, i);
    	}
    }
    public number_(): NumberContext[];
    public number_(i: number): NumberContext | null;
    public number_(i?: number): NumberContext[] | NumberContext | null {
        if (i === undefined) {
            return this.getRuleContexts(NumberContext);
        }

        return this.getRuleContext(i, NumberContext);
    }
    public amount(): AmountContext[];
    public amount(i: number): AmountContext | null;
    public amount(i?: number): AmountContext[] | AmountContext | null {
        if (i === undefined) {
            return this.getRuleContexts(AmountContext);
        }

        return this.getRuleContext(i, AmountContext);
    }
    public account(): AccountContext[];
    public account(i: number): AccountContext | null;
    public account(i?: number): AccountContext[] | AccountContext | null {
        if (i === undefined) {
            return this.getRuleContexts(AccountContext);
        }

        return this.getRuleContext(i, AccountContext);
    }
    public TAG(): antlr.TerminalNode[];
    public TAG(i: number): antlr.TerminalNode | null;
    public TAG(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(BeancountParser.TAG);
    	} else {
    		return this.getToken(BeancountParser.TAG, i);
    	}
    }
    public LINK(): antlr.TerminalNode[];
    public LINK(i: number): antlr.TerminalNode | null;
    public LINK(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(BeancountParser.LINK);
    	} else {
    		return this.getToken(BeancountParser.LINK, i);
    	}
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_custom;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitCustom) {
            return visitor.visitCustom(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class OptionsContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public STRING(): antlr.TerminalNode[];
    public STRING(i: number): antlr.TerminalNode | null;
    public STRING(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(BeancountParser.STRING);
    	} else {
    		return this.getToken(BeancountParser.STRING, i);
    	}
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_options;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitOptions) {
            return visitor.visitOptions(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class PluginContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public STRING(): antlr.TerminalNode[];
    public STRING(i: number): antlr.TerminalNode | null;
    public STRING(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(BeancountParser.STRING);
    	} else {
    		return this.getToken(BeancountParser.STRING, i);
    	}
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_plugin;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitPlugin) {
            return visitor.visitPlugin(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class IncludeContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public STRING(): antlr.TerminalNode {
        return this.getToken(BeancountParser.STRING, 0)!;
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_include;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitInclude) {
            return visitor.visitInclude(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class AccountContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public ACCOUNT(): antlr.TerminalNode {
        return this.getToken(BeancountParser.ACCOUNT, 0)!;
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_account;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitAccount) {
            return visitor.visitAccount(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}
