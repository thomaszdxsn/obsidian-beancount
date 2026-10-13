
import * as antlr from "antlr4ng";
import { Token } from "antlr4ng";

import { BeancountVisitor } from "./BeancountVisitor.js";



export class BeancountParser extends antlr.Parser {
    public static readonly EOL = 1;
    public static readonly WS = 2;
    public static readonly COMMENT = 3;
    public static readonly TXN = 4;
    public static readonly BALANCE = 5;
    public static readonly OPEN = 6;
    public static readonly CLOSE = 7;
    public static readonly COMMODITY = 8;
    public static readonly PAD = 9;
    public static readonly EVENT = 10;
    public static readonly QUERY = 11;
    public static readonly CUSTOM = 12;
    public static readonly PRICE = 13;
    public static readonly NOTE = 14;
    public static readonly DOCUMENT = 15;
    public static readonly PUSHTAG = 16;
    public static readonly POPTAG = 17;
    public static readonly PUSHMETA = 18;
    public static readonly POPMETA = 19;
    public static readonly OPTION = 20;
    public static readonly PLUGIN = 21;
    public static readonly INCLUDE = 22;
    public static readonly BOOL = 23;
    public static readonly NONE = 24;
    public static readonly DATE = 25;
    public static readonly ACCOUNT = 26;
    public static readonly CAPITAL = 27;
    public static readonly CURRENCY = 28;
    public static readonly STRING = 29;
    public static readonly NUMBER = 30;
    public static readonly TAG = 31;
    public static readonly LINK = 32;
    public static readonly KEY = 33;
    public static readonly PIPE = 34;
    public static readonly ATAT = 35;
    public static readonly AT = 36;
    public static readonly LCURLCURL = 37;
    public static readonly RCURLCURL = 38;
    public static readonly LCURL = 39;
    public static readonly RCURL = 40;
    public static readonly COMMA = 41;
    public static readonly TILDE = 42;
    public static readonly PLUS = 43;
    public static readonly MINUS = 44;
    public static readonly SLASH = 45;
    public static readonly LPAREN = 46;
    public static readonly RPAREN = 47;
    public static readonly HASH = 48;
    public static readonly ASTERISK = 49;
    public static readonly FLAG = 50;
    public static readonly INDENT = 51;
    public static readonly RULE_beancountFile = 0;
    public static readonly RULE_directive = 1;
    public static readonly RULE_eol = 2;
    public static readonly RULE_transaction = 3;
    public static readonly RULE_txn_flag = 4;
    public static readonly RULE_flag = 5;
    public static readonly RULE_txn_strings = 6;
    public static readonly RULE_tags_links = 7;
    public static readonly RULE_tags_links_line = 8;
    public static readonly RULE_posting = 9;
    public static readonly RULE_incomplete_amount = 10;
    public static readonly RULE_amount = 11;
    public static readonly RULE_number = 12;
    public static readonly RULE_commodity = 13;
    public static readonly RULE_cost = 14;
    public static readonly RULE_cost_comp_list = 15;
    public static readonly RULE_cost_comp = 16;
    public static readonly RULE_compound_amount = 17;
    public static readonly RULE_price_annotation = 18;
    public static readonly RULE_metadata = 19;
    public static readonly RULE_key_value_line = 20;
    public static readonly RULE_key_value = 21;
    public static readonly RULE_key_value_value = 22;
    public static readonly RULE_price = 23;
    public static readonly RULE_balance = 24;
    public static readonly RULE_open = 25;
    public static readonly RULE_booking = 26;
    public static readonly RULE_close = 27;
    public static readonly RULE_commodity_directive = 28;
    public static readonly RULE_pad = 29;
    public static readonly RULE_note = 30;
    public static readonly RULE_document = 31;
    public static readonly RULE_event = 32;
    public static readonly RULE_query = 33;
    public static readonly RULE_custom = 34;
    public static readonly RULE_custom_value = 35;
    public static readonly RULE_options = 36;
    public static readonly RULE_plugin = 37;
    public static readonly RULE_include = 38;
    public static readonly RULE_pushtag = 39;
    public static readonly RULE_poptag = 40;
    public static readonly RULE_pushmeta = 41;
    public static readonly RULE_popmeta = 42;
    public static readonly RULE_account = 43;

    public static readonly literalNames = [
        null, null, null, null, "'txn'", "'balance'", "'open'", "'close'", 
        "'commodity'", "'pad'", "'event'", "'query'", "'custom'", "'price'", 
        "'note'", "'document'", "'pushtag'", "'poptag'", "'pushmeta'", "'popmeta'", 
        "'option'", "'plugin'", "'include'", null, "'NULL'", null, null, 
        null, null, null, null, null, null, null, "'|'", "'@@'", "'@'", 
        "'{{'", "'}}'", "'{'", "'}'", "','", "'~'", "'+'", "'-'", "'/'", 
        "'('", "')'", "'#'", "'*'"
    ];

    public static readonly symbolicNames = [
        null, "EOL", "WS", "COMMENT", "TXN", "BALANCE", "OPEN", "CLOSE", 
        "COMMODITY", "PAD", "EVENT", "QUERY", "CUSTOM", "PRICE", "NOTE", 
        "DOCUMENT", "PUSHTAG", "POPTAG", "PUSHMETA", "POPMETA", "OPTION", 
        "PLUGIN", "INCLUDE", "BOOL", "NONE", "DATE", "ACCOUNT", "CAPITAL", 
        "CURRENCY", "STRING", "NUMBER", "TAG", "LINK", "KEY", "PIPE", "ATAT", 
        "AT", "LCURLCURL", "RCURLCURL", "LCURL", "RCURL", "COMMA", "TILDE", 
        "PLUS", "MINUS", "SLASH", "LPAREN", "RPAREN", "HASH", "ASTERISK", 
        "FLAG", "INDENT"
    ];
    public static readonly ruleNames = [
        "beancountFile", "directive", "eol", "transaction", "txn_flag", 
        "flag", "txn_strings", "tags_links", "tags_links_line", "posting", 
        "incomplete_amount", "amount", "number", "commodity", "cost", "cost_comp_list", 
        "cost_comp", "compound_amount", "price_annotation", "metadata", 
        "key_value_line", "key_value", "key_value_value", "price", "balance", 
        "open", "booking", "close", "commodity_directive", "pad", "note", 
        "document", "event", "query", "custom", "custom_value", "options", 
        "plugin", "include", "pushtag", "poptag", "pushmeta", "popmeta", 
        "account",
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
            this.state = 92;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            while ((((_la) & ~0x1F) === 0 && ((1 << _la) & 41877506) !== 0)) {
                {
                this.state = 90;
                this.errorHandler.sync(this);
                switch (this.tokenStream.LA(1)) {
                case BeancountParser.EOL:
                    {
                    this.state = 88;
                    this.match(BeancountParser.EOL);
                    }
                    break;
                case BeancountParser.PUSHTAG:
                case BeancountParser.POPTAG:
                case BeancountParser.PUSHMETA:
                case BeancountParser.POPMETA:
                case BeancountParser.OPTION:
                case BeancountParser.PLUGIN:
                case BeancountParser.INCLUDE:
                case BeancountParser.DATE:
                    {
                    this.state = 89;
                    this.directive();
                    }
                    break;
                default:
                    throw new antlr.NoViableAltException(this);
                }
                }
                this.state = 94;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
            }
            this.state = 95;
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
            this.state = 116;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 2, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 97;
                this.transaction();
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 98;
                this.price();
                }
                break;
            case 3:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 99;
                this.balance();
                }
                break;
            case 4:
                this.enterOuterAlt(localContext, 4);
                {
                this.state = 100;
                this.open();
                }
                break;
            case 5:
                this.enterOuterAlt(localContext, 5);
                {
                this.state = 101;
                this.close();
                }
                break;
            case 6:
                this.enterOuterAlt(localContext, 6);
                {
                this.state = 102;
                this.commodity_directive();
                }
                break;
            case 7:
                this.enterOuterAlt(localContext, 7);
                {
                this.state = 103;
                this.pad();
                }
                break;
            case 8:
                this.enterOuterAlt(localContext, 8);
                {
                this.state = 104;
                this.note();
                }
                break;
            case 9:
                this.enterOuterAlt(localContext, 9);
                {
                this.state = 105;
                this.document();
                }
                break;
            case 10:
                this.enterOuterAlt(localContext, 10);
                {
                this.state = 106;
                this.event();
                }
                break;
            case 11:
                this.enterOuterAlt(localContext, 11);
                {
                this.state = 107;
                this.query();
                }
                break;
            case 12:
                this.enterOuterAlt(localContext, 12);
                {
                this.state = 108;
                this.custom();
                }
                break;
            case 13:
                this.enterOuterAlt(localContext, 13);
                {
                this.state = 109;
                this.options();
                }
                break;
            case 14:
                this.enterOuterAlt(localContext, 14);
                {
                this.state = 110;
                this.plugin();
                }
                break;
            case 15:
                this.enterOuterAlt(localContext, 15);
                {
                this.state = 111;
                this.include();
                }
                break;
            case 16:
                this.enterOuterAlt(localContext, 16);
                {
                this.state = 112;
                this.pushtag();
                }
                break;
            case 17:
                this.enterOuterAlt(localContext, 17);
                {
                this.state = 113;
                this.poptag();
                }
                break;
            case 18:
                this.enterOuterAlt(localContext, 18);
                {
                this.state = 114;
                this.pushmeta();
                }
                break;
            case 19:
                this.enterOuterAlt(localContext, 19);
                {
                this.state = 115;
                this.popmeta();
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
    public eol(): EolContext {
        let localContext = new EolContext(this.context, this.state);
        this.enterRule(localContext, 4, BeancountParser.RULE_eol);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 118;
            _la = this.tokenStream.LA(1);
            if(!(_la === -1 || _la === 1)) {
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
    public transaction(): TransactionContext {
        let localContext = new TransactionContext(this.context, this.state);
        this.enterRule(localContext, 6, BeancountParser.RULE_transaction);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 120;
            this.match(BeancountParser.DATE);
            this.state = 121;
            localContext._txnFlag = this.txn_flag();
            this.state = 123;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 29) {
                {
                this.state = 122;
                localContext._strings = this.txn_strings();
                }
            }

            this.state = 125;
            localContext._tagsLinks = this.tags_links();
            this.state = 126;
            this.eol();
            this.state = 131;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 5, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    this.state = 129;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 4, this.context) ) {
                    case 1:
                        {
                        this.state = 127;
                        localContext._key_value_line = this.key_value_line();
                        localContext._meta.push(localContext._key_value_line);
                        }
                        break;
                    case 2:
                        {
                        this.state = 128;
                        localContext._tags_links_line = this.tags_links_line();
                        localContext._tagLines.push(localContext._tags_links_line);
                        }
                        break;
                    }
                    }
                }
                this.state = 133;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 5, this.context);
            }
            this.state = 137;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            while (_la === 51) {
                {
                {
                this.state = 134;
                localContext._posting = this.posting();
                localContext._postings.push(localContext._posting);
                }
                }
                this.state = 139;
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
        this.enterRule(localContext, 8, BeancountParser.RULE_txn_flag);
        try {
            this.state = 142;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case BeancountParser.TXN:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 140;
                this.match(BeancountParser.TXN);
                }
                break;
            case BeancountParser.CAPITAL:
            case BeancountParser.HASH:
            case BeancountParser.ASTERISK:
            case BeancountParser.FLAG:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 141;
                this.flag();
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
    public flag(): FlagContext {
        let localContext = new FlagContext(this.context, this.state);
        this.enterRule(localContext, 10, BeancountParser.RULE_flag);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 144;
            _la = this.tokenStream.LA(1);
            if(!(((((_la - 27)) & ~0x1F) === 0 && ((1 << (_la - 27)) & 14680065) !== 0))) {
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
    public txn_strings(): Txn_stringsContext {
        let localContext = new Txn_stringsContext(this.context, this.state);
        this.enterRule(localContext, 12, BeancountParser.RULE_txn_strings);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 150;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 9, this.context) ) {
            case 1:
                {
                this.state = 146;
                localContext._payee = this.match(BeancountParser.STRING);
                this.state = 148;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 34) {
                    {
                    this.state = 147;
                    this.match(BeancountParser.PIPE);
                    }
                }

                }
                break;
            }
            this.state = 152;
            localContext._narration = this.match(BeancountParser.STRING);
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
    public tags_links(): Tags_linksContext {
        let localContext = new Tags_linksContext(this.context, this.state);
        this.enterRule(localContext, 14, BeancountParser.RULE_tags_links);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 157;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            while (_la === 31 || _la === 32) {
                {
                {
                this.state = 154;
                _la = this.tokenStream.LA(1);
                if(!(_la === 31 || _la === 32)) {
                this.errorHandler.recoverInline(this);
                }
                else {
                    this.errorHandler.reportMatch(this);
                    this.consume();
                }
                }
                }
                this.state = 159;
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
    public tags_links_line(): Tags_links_lineContext {
        let localContext = new Tags_links_lineContext(this.context, this.state);
        this.enterRule(localContext, 16, BeancountParser.RULE_tags_links_line);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 160;
            this.match(BeancountParser.INDENT);
            this.state = 162;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            do {
                {
                {
                this.state = 161;
                _la = this.tokenStream.LA(1);
                if(!(_la === 31 || _la === 32)) {
                this.errorHandler.recoverInline(this);
                }
                else {
                    this.errorHandler.reportMatch(this);
                    this.consume();
                }
                }
                }
                this.state = 164;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
            } while (_la === 31 || _la === 32);
            this.state = 166;
            this.eol();
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
        this.enterRule(localContext, 18, BeancountParser.RULE_posting);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 168;
            this.match(BeancountParser.INDENT);
            this.state = 170;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (((((_la - 27)) & ~0x1F) === 0 && ((1 << (_la - 27)) & 14680065) !== 0)) {
                {
                this.state = 169;
                localContext._postingFlag = this.flag();
                }
            }

            this.state = 172;
            localContext._acct = this.account();
            this.state = 174;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (((((_la - 27)) & ~0x1F) === 0 && ((1 << (_la - 27)) & 720907) !== 0)) {
                {
                this.state = 173;
                localContext._units = this.incomplete_amount();
                }
            }

            this.state = 177;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 37 || _la === 39) {
                {
                this.state = 176;
                localContext._costSpec = this.cost();
                }
            }

            this.state = 180;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 35 || _la === 36) {
                {
                this.state = 179;
                localContext._priceSpec = this.price_annotation();
                }
            }

            this.state = 182;
            this.eol();
            this.state = 183;
            localContext._meta = this.metadata();
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
    public incomplete_amount(): Incomplete_amountContext {
        let localContext = new Incomplete_amountContext(this.context, this.state);
        this.enterRule(localContext, 20, BeancountParser.RULE_incomplete_amount);
        let _la: number;
        try {
            this.state = 190;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case BeancountParser.NUMBER:
            case BeancountParser.PLUS:
            case BeancountParser.MINUS:
            case BeancountParser.LPAREN:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 185;
                localContext._num = this.number_(0);
                this.state = 187;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 27 || _la === 28) {
                    {
                    this.state = 186;
                    localContext._cur = this.commodity();
                    }
                }

                }
                break;
            case BeancountParser.CAPITAL:
            case BeancountParser.CURRENCY:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 189;
                localContext._cur = this.commodity();
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
    public amount(): AmountContext {
        let localContext = new AmountContext(this.context, this.state);
        this.enterRule(localContext, 22, BeancountParser.RULE_amount);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 192;
            this.number_(0);
            this.state = 193;
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

    public number_(): NumberContext;
    public number_(_p: number): NumberContext;
    public number_(_p?: number): NumberContext {
        if (_p === undefined) {
            _p = 0;
        }

        let parentContext = this.context;
        let parentState = this.state;
        let localContext = new NumberContext(this.context, parentState);
        let _startState = 24;
        this.enterRecursionRule(localContext, 24, BeancountParser.RULE_number, _p);
        let _la: number;
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 203;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case BeancountParser.NUMBER:
                {
                this.state = 196;
                this.match(BeancountParser.NUMBER);
                }
                break;
            case BeancountParser.LPAREN:
                {
                this.state = 197;
                this.match(BeancountParser.LPAREN);
                this.state = 198;
                this.number_(0);
                this.state = 199;
                this.match(BeancountParser.RPAREN);
                }
                break;
            case BeancountParser.PLUS:
            case BeancountParser.MINUS:
                {
                this.state = 201;
                _la = this.tokenStream.LA(1);
                if(!(_la === 43 || _la === 44)) {
                this.errorHandler.recoverInline(this);
                }
                else {
                    this.errorHandler.reportMatch(this);
                    this.consume();
                }
                this.state = 202;
                this.number_(3);
                }
                break;
            default:
                throw new antlr.NoViableAltException(this);
            }
            this.context!.stop = this.tokenStream.LT(-1);
            this.state = 213;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 20, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    if (this.parseListeners != null) {
                        this.triggerExitRuleEvent();
                    }
                    {
                    this.state = 211;
                    this.errorHandler.sync(this);
                    switch (this.interpreter.adaptivePredict(this.tokenStream, 19, this.context) ) {
                    case 1:
                        {
                        localContext = new NumberContext(parentContext, parentState);
                        this.pushNewRecursionContext(localContext, _startState, BeancountParser.RULE_number);
                        this.state = 205;
                        if (!(this.precpred(this.context, 2))) {
                            throw this.createFailedPredicateException("this.precpred(this.context, 2)");
                        }
                        this.state = 206;
                        _la = this.tokenStream.LA(1);
                        if(!(_la === 45 || _la === 49)) {
                        this.errorHandler.recoverInline(this);
                        }
                        else {
                            this.errorHandler.reportMatch(this);
                            this.consume();
                        }
                        this.state = 207;
                        this.number_(3);
                        }
                        break;
                    case 2:
                        {
                        localContext = new NumberContext(parentContext, parentState);
                        this.pushNewRecursionContext(localContext, _startState, BeancountParser.RULE_number);
                        this.state = 208;
                        if (!(this.precpred(this.context, 1))) {
                            throw this.createFailedPredicateException("this.precpred(this.context, 1)");
                        }
                        this.state = 209;
                        _la = this.tokenStream.LA(1);
                        if(!(_la === 43 || _la === 44)) {
                        this.errorHandler.recoverInline(this);
                        }
                        else {
                            this.errorHandler.reportMatch(this);
                            this.consume();
                        }
                        this.state = 210;
                        this.number_(2);
                        }
                        break;
                    }
                    }
                }
                this.state = 215;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 20, this.context);
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
            this.unrollRecursionContexts(parentContext);
        }
        return localContext;
    }
    public commodity(): CommodityContext {
        let localContext = new CommodityContext(this.context, this.state);
        this.enterRule(localContext, 26, BeancountParser.RULE_commodity);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 216;
            _la = this.tokenStream.LA(1);
            if(!(_la === 27 || _la === 28)) {
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
    public cost(): CostContext {
        let localContext = new CostContext(this.context, this.state);
        this.enterRule(localContext, 28, BeancountParser.RULE_cost);
        let _la: number;
        try {
            this.state = 228;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case BeancountParser.LCURL:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 218;
                this.match(BeancountParser.LCURL);
                this.state = 220;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (((((_la - 25)) & ~0x1F) === 0 && ((1 << (_la - 25)) & 28049469) !== 0)) {
                    {
                    this.state = 219;
                    this.cost_comp_list();
                    }
                }

                this.state = 222;
                this.match(BeancountParser.RCURL);
                }
                break;
            case BeancountParser.LCURLCURL:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 223;
                this.match(BeancountParser.LCURLCURL);
                this.state = 225;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (((((_la - 25)) & ~0x1F) === 0 && ((1 << (_la - 25)) & 28049469) !== 0)) {
                    {
                    this.state = 224;
                    this.cost_comp_list();
                    }
                }

                this.state = 227;
                this.match(BeancountParser.RCURLCURL);
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
    public cost_comp_list(): Cost_comp_listContext {
        let localContext = new Cost_comp_listContext(this.context, this.state);
        this.enterRule(localContext, 30, BeancountParser.RULE_cost_comp_list);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 230;
            this.cost_comp();
            this.state = 235;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            while (_la === 41) {
                {
                {
                this.state = 231;
                this.match(BeancountParser.COMMA);
                this.state = 232;
                this.cost_comp();
                }
                }
                this.state = 237;
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
    public cost_comp(): Cost_compContext {
        let localContext = new Cost_compContext(this.context, this.state);
        this.enterRule(localContext, 32, BeancountParser.RULE_cost_comp);
        try {
            this.state = 242;
            this.errorHandler.sync(this);
            switch (this.tokenStream.LA(1)) {
            case BeancountParser.CAPITAL:
            case BeancountParser.CURRENCY:
            case BeancountParser.NUMBER:
            case BeancountParser.PLUS:
            case BeancountParser.MINUS:
            case BeancountParser.LPAREN:
            case BeancountParser.HASH:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 238;
                this.compound_amount();
                }
                break;
            case BeancountParser.DATE:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 239;
                this.match(BeancountParser.DATE);
                }
                break;
            case BeancountParser.STRING:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 240;
                this.match(BeancountParser.STRING);
                }
                break;
            case BeancountParser.ASTERISK:
                this.enterOuterAlt(localContext, 4);
                {
                this.state = 241;
                this.match(BeancountParser.ASTERISK);
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
    public compound_amount(): Compound_amountContext {
        let localContext = new Compound_amountContext(this.context, this.state);
        this.enterRule(localContext, 34, BeancountParser.RULE_compound_amount);
        let _la: number;
        try {
            this.state = 257;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 29, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 245;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (((((_la - 30)) & ~0x1F) === 0 && ((1 << (_la - 30)) & 90113) !== 0)) {
                    {
                    this.state = 244;
                    localContext._perUnit = this.number_(0);
                    }
                }

                this.state = 247;
                this.match(BeancountParser.HASH);
                this.state = 249;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (((((_la - 30)) & ~0x1F) === 0 && ((1 << (_la - 30)) & 90113) !== 0)) {
                    {
                    this.state = 248;
                    localContext._total = this.number_(0);
                    }
                }

                this.state = 251;
                this.commodity();
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 252;
                this.number_(0);
                this.state = 254;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                if (_la === 27 || _la === 28) {
                    {
                    this.state = 253;
                    this.commodity();
                    }
                }

                }
                break;
            case 3:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 256;
                this.commodity();
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
    public price_annotation(): Price_annotationContext {
        let localContext = new Price_annotationContext(this.context, this.state);
        this.enterRule(localContext, 36, BeancountParser.RULE_price_annotation);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 259;
            _la = this.tokenStream.LA(1);
            if(!(_la === 35 || _la === 36)) {
            this.errorHandler.recoverInline(this);
            }
            else {
                this.errorHandler.reportMatch(this);
                this.consume();
            }
            this.state = 261;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (((((_la - 27)) & ~0x1F) === 0 && ((1 << (_la - 27)) & 720907) !== 0)) {
                {
                this.state = 260;
                this.incomplete_amount();
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
    public metadata(): MetadataContext {
        let localContext = new MetadataContext(this.context, this.state);
        this.enterRule(localContext, 38, BeancountParser.RULE_metadata);
        try {
            let alternative: number;
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 266;
            this.errorHandler.sync(this);
            alternative = this.interpreter.adaptivePredict(this.tokenStream, 31, this.context);
            while (alternative !== 2 && alternative !== antlr.ATN.INVALID_ALT_NUMBER) {
                if (alternative === 1) {
                    {
                    {
                    this.state = 263;
                    localContext._key_value_line = this.key_value_line();
                    localContext._lines.push(localContext._key_value_line);
                    }
                    }
                }
                this.state = 268;
                this.errorHandler.sync(this);
                alternative = this.interpreter.adaptivePredict(this.tokenStream, 31, this.context);
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
    public key_value_line(): Key_value_lineContext {
        let localContext = new Key_value_lineContext(this.context, this.state);
        this.enterRule(localContext, 40, BeancountParser.RULE_key_value_line);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 269;
            this.match(BeancountParser.INDENT);
            this.state = 270;
            this.key_value();
            this.state = 271;
            this.eol();
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
    public key_value(): Key_valueContext {
        let localContext = new Key_valueContext(this.context, this.state);
        this.enterRule(localContext, 42, BeancountParser.RULE_key_value);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 273;
            this.match(BeancountParser.KEY);
            this.state = 275;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (((((_la - 23)) & ~0x1F) === 0 && ((1 << (_la - 23)) & 11534847) !== 0)) {
                {
                this.state = 274;
                this.key_value_value();
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
    public key_value_value(): Key_value_valueContext {
        let localContext = new Key_value_valueContext(this.context, this.state);
        this.enterRule(localContext, 44, BeancountParser.RULE_key_value_value);
        try {
            this.state = 286;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 33, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 277;
                this.match(BeancountParser.STRING);
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 278;
                this.account();
                }
                break;
            case 3:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 279;
                this.match(BeancountParser.DATE);
                }
                break;
            case 4:
                this.enterOuterAlt(localContext, 4);
                {
                this.state = 280;
                this.commodity();
                }
                break;
            case 5:
                this.enterOuterAlt(localContext, 5);
                {
                this.state = 281;
                this.match(BeancountParser.TAG);
                }
                break;
            case 6:
                this.enterOuterAlt(localContext, 6);
                {
                this.state = 282;
                this.match(BeancountParser.BOOL);
                }
                break;
            case 7:
                this.enterOuterAlt(localContext, 7);
                {
                this.state = 283;
                this.match(BeancountParser.NONE);
                }
                break;
            case 8:
                this.enterOuterAlt(localContext, 8);
                {
                this.state = 284;
                this.amount();
                }
                break;
            case 9:
                this.enterOuterAlt(localContext, 9);
                {
                this.state = 285;
                this.number_(0);
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
    public price(): PriceContext {
        let localContext = new PriceContext(this.context, this.state);
        this.enterRule(localContext, 46, BeancountParser.RULE_price);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 288;
            this.match(BeancountParser.DATE);
            this.state = 289;
            this.match(BeancountParser.PRICE);
            this.state = 290;
            this.commodity();
            this.state = 291;
            this.amount();
            this.state = 292;
            this.eol();
            this.state = 293;
            this.metadata();
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
        this.enterRule(localContext, 48, BeancountParser.RULE_balance);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 295;
            this.match(BeancountParser.DATE);
            this.state = 296;
            this.match(BeancountParser.BALANCE);
            this.state = 297;
            this.account();
            this.state = 298;
            localContext._balanceNumber = this.number_(0);
            this.state = 301;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 42) {
                {
                this.state = 299;
                this.match(BeancountParser.TILDE);
                this.state = 300;
                localContext._tolerance = this.number_(0);
                }
            }

            this.state = 303;
            this.commodity();
            this.state = 304;
            this.eol();
            this.state = 305;
            this.metadata();
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
        this.enterRule(localContext, 50, BeancountParser.RULE_open);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 307;
            this.match(BeancountParser.DATE);
            this.state = 308;
            this.match(BeancountParser.OPEN);
            this.state = 309;
            this.account();
            this.state = 318;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 27 || _la === 28) {
                {
                this.state = 310;
                this.commodity();
                this.state = 315;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
                while (_la === 41) {
                    {
                    {
                    this.state = 311;
                    this.match(BeancountParser.COMMA);
                    this.state = 312;
                    this.commodity();
                    }
                    }
                    this.state = 317;
                    this.errorHandler.sync(this);
                    _la = this.tokenStream.LA(1);
                }
                }
            }

            this.state = 321;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 29) {
                {
                this.state = 320;
                this.booking();
                }
            }

            this.state = 323;
            this.eol();
            this.state = 324;
            this.metadata();
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
        this.enterRule(localContext, 52, BeancountParser.RULE_booking);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 326;
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
        this.enterRule(localContext, 54, BeancountParser.RULE_close);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 328;
            this.match(BeancountParser.DATE);
            this.state = 329;
            this.match(BeancountParser.CLOSE);
            this.state = 330;
            this.account();
            this.state = 331;
            this.eol();
            this.state = 332;
            this.metadata();
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
        this.enterRule(localContext, 56, BeancountParser.RULE_commodity_directive);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 334;
            this.match(BeancountParser.DATE);
            this.state = 335;
            this.match(BeancountParser.COMMODITY);
            this.state = 336;
            this.commodity();
            this.state = 337;
            this.eol();
            this.state = 338;
            this.metadata();
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
        this.enterRule(localContext, 58, BeancountParser.RULE_pad);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 340;
            this.match(BeancountParser.DATE);
            this.state = 341;
            this.match(BeancountParser.PAD);
            this.state = 342;
            this.account();
            this.state = 343;
            this.account();
            this.state = 344;
            this.eol();
            this.state = 345;
            this.metadata();
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
        this.enterRule(localContext, 60, BeancountParser.RULE_note);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 347;
            this.match(BeancountParser.DATE);
            this.state = 348;
            this.match(BeancountParser.NOTE);
            this.state = 349;
            this.account();
            this.state = 350;
            this.match(BeancountParser.STRING);
            this.state = 351;
            this.tags_links();
            this.state = 352;
            this.eol();
            this.state = 353;
            this.metadata();
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
        this.enterRule(localContext, 62, BeancountParser.RULE_document);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 355;
            this.match(BeancountParser.DATE);
            this.state = 356;
            this.match(BeancountParser.DOCUMENT);
            this.state = 357;
            this.account();
            this.state = 358;
            this.match(BeancountParser.STRING);
            this.state = 359;
            this.tags_links();
            this.state = 360;
            this.eol();
            this.state = 361;
            this.metadata();
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
        this.enterRule(localContext, 64, BeancountParser.RULE_event);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 363;
            this.match(BeancountParser.DATE);
            this.state = 364;
            this.match(BeancountParser.EVENT);
            this.state = 365;
            this.match(BeancountParser.STRING);
            this.state = 366;
            this.match(BeancountParser.STRING);
            this.state = 367;
            this.eol();
            this.state = 368;
            this.metadata();
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
        this.enterRule(localContext, 66, BeancountParser.RULE_query);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 370;
            this.match(BeancountParser.DATE);
            this.state = 371;
            this.match(BeancountParser.QUERY);
            this.state = 372;
            this.match(BeancountParser.STRING);
            this.state = 373;
            this.match(BeancountParser.STRING);
            this.state = 374;
            this.eol();
            this.state = 375;
            this.metadata();
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
        this.enterRule(localContext, 68, BeancountParser.RULE_custom);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 377;
            this.match(BeancountParser.DATE);
            this.state = 378;
            this.match(BeancountParser.CUSTOM);
            this.state = 379;
            this.match(BeancountParser.STRING);
            this.state = 383;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            while (((((_la - 23)) & ~0x1F) === 0 && ((1 << (_la - 23)) & 11534541) !== 0)) {
                {
                {
                this.state = 380;
                this.custom_value();
                }
                }
                this.state = 385;
                this.errorHandler.sync(this);
                _la = this.tokenStream.LA(1);
            }
            this.state = 386;
            this.eol();
            this.state = 387;
            this.metadata();
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
    public custom_value(): Custom_valueContext {
        let localContext = new Custom_valueContext(this.context, this.state);
        this.enterRule(localContext, 70, BeancountParser.RULE_custom_value);
        try {
            this.state = 395;
            this.errorHandler.sync(this);
            switch (this.interpreter.adaptivePredict(this.tokenStream, 39, this.context) ) {
            case 1:
                this.enterOuterAlt(localContext, 1);
                {
                this.state = 389;
                this.match(BeancountParser.STRING);
                }
                break;
            case 2:
                this.enterOuterAlt(localContext, 2);
                {
                this.state = 390;
                this.match(BeancountParser.DATE);
                }
                break;
            case 3:
                this.enterOuterAlt(localContext, 3);
                {
                this.state = 391;
                this.match(BeancountParser.BOOL);
                }
                break;
            case 4:
                this.enterOuterAlt(localContext, 4);
                {
                this.state = 392;
                this.amount();
                }
                break;
            case 5:
                this.enterOuterAlt(localContext, 5);
                {
                this.state = 393;
                this.number_(0);
                }
                break;
            case 6:
                this.enterOuterAlt(localContext, 6);
                {
                this.state = 394;
                this.account();
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
    public options(): OptionsContext {
        let localContext = new OptionsContext(this.context, this.state);
        this.enterRule(localContext, 72, BeancountParser.RULE_options);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 397;
            this.match(BeancountParser.OPTION);
            this.state = 398;
            this.match(BeancountParser.STRING);
            this.state = 399;
            this.match(BeancountParser.STRING);
            this.state = 400;
            this.eol();
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
        this.enterRule(localContext, 74, BeancountParser.RULE_plugin);
        let _la: number;
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 402;
            this.match(BeancountParser.PLUGIN);
            this.state = 403;
            this.match(BeancountParser.STRING);
            this.state = 405;
            this.errorHandler.sync(this);
            _la = this.tokenStream.LA(1);
            if (_la === 29) {
                {
                this.state = 404;
                this.match(BeancountParser.STRING);
                }
            }

            this.state = 407;
            this.eol();
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
        this.enterRule(localContext, 76, BeancountParser.RULE_include);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 409;
            this.match(BeancountParser.INCLUDE);
            this.state = 410;
            this.match(BeancountParser.STRING);
            this.state = 411;
            this.eol();
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
    public pushtag(): PushtagContext {
        let localContext = new PushtagContext(this.context, this.state);
        this.enterRule(localContext, 78, BeancountParser.RULE_pushtag);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 413;
            this.match(BeancountParser.PUSHTAG);
            this.state = 414;
            this.match(BeancountParser.TAG);
            this.state = 415;
            this.eol();
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
    public poptag(): PoptagContext {
        let localContext = new PoptagContext(this.context, this.state);
        this.enterRule(localContext, 80, BeancountParser.RULE_poptag);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 417;
            this.match(BeancountParser.POPTAG);
            this.state = 418;
            this.match(BeancountParser.TAG);
            this.state = 419;
            this.eol();
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
    public pushmeta(): PushmetaContext {
        let localContext = new PushmetaContext(this.context, this.state);
        this.enterRule(localContext, 82, BeancountParser.RULE_pushmeta);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 421;
            this.match(BeancountParser.PUSHMETA);
            this.state = 422;
            this.key_value();
            this.state = 423;
            this.eol();
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
    public popmeta(): PopmetaContext {
        let localContext = new PopmetaContext(this.context, this.state);
        this.enterRule(localContext, 84, BeancountParser.RULE_popmeta);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 425;
            this.match(BeancountParser.POPMETA);
            this.state = 426;
            this.match(BeancountParser.KEY);
            this.state = 427;
            this.eol();
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
        this.enterRule(localContext, 86, BeancountParser.RULE_account);
        try {
            this.enterOuterAlt(localContext, 1);
            {
            this.state = 429;
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

    public override sempred(localContext: antlr.ParserRuleContext | null, ruleIndex: number, predIndex: number): boolean {
        switch (ruleIndex) {
        case 12:
            return this.number_sempred(localContext as NumberContext, predIndex);
        }
        return true;
    }
    private number_sempred(localContext: NumberContext | null, predIndex: number): boolean {
        switch (predIndex) {
        case 0:
            return this.precpred(this.context, 2);
        case 1:
            return this.precpred(this.context, 1);
        }
        return true;
    }

    public static readonly _serializedATN: number[] = [
        4,1,51,432,2,0,7,0,2,1,7,1,2,2,7,2,2,3,7,3,2,4,7,4,2,5,7,5,2,6,7,
        6,2,7,7,7,2,8,7,8,2,9,7,9,2,10,7,10,2,11,7,11,2,12,7,12,2,13,7,13,
        2,14,7,14,2,15,7,15,2,16,7,16,2,17,7,17,2,18,7,18,2,19,7,19,2,20,
        7,20,2,21,7,21,2,22,7,22,2,23,7,23,2,24,7,24,2,25,7,25,2,26,7,26,
        2,27,7,27,2,28,7,28,2,29,7,29,2,30,7,30,2,31,7,31,2,32,7,32,2,33,
        7,33,2,34,7,34,2,35,7,35,2,36,7,36,2,37,7,37,2,38,7,38,2,39,7,39,
        2,40,7,40,2,41,7,41,2,42,7,42,2,43,7,43,1,0,1,0,5,0,91,8,0,10,0,
        12,0,94,9,0,1,0,1,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
        1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,3,1,117,8,1,1,2,1,2,1,3,1,3,1,3,
        3,3,124,8,3,1,3,1,3,1,3,1,3,5,3,130,8,3,10,3,12,3,133,9,3,1,3,5,
        3,136,8,3,10,3,12,3,139,9,3,1,4,1,4,3,4,143,8,4,1,5,1,5,1,6,1,6,
        3,6,149,8,6,3,6,151,8,6,1,6,1,6,1,7,5,7,156,8,7,10,7,12,7,159,9,
        7,1,8,1,8,4,8,163,8,8,11,8,12,8,164,1,8,1,8,1,9,1,9,3,9,171,8,9,
        1,9,1,9,3,9,175,8,9,1,9,3,9,178,8,9,1,9,3,9,181,8,9,1,9,1,9,1,9,
        1,10,1,10,3,10,188,8,10,1,10,3,10,191,8,10,1,11,1,11,1,11,1,12,1,
        12,1,12,1,12,1,12,1,12,1,12,1,12,3,12,204,8,12,1,12,1,12,1,12,1,
        12,1,12,1,12,5,12,212,8,12,10,12,12,12,215,9,12,1,13,1,13,1,14,1,
        14,3,14,221,8,14,1,14,1,14,1,14,3,14,226,8,14,1,14,3,14,229,8,14,
        1,15,1,15,1,15,5,15,234,8,15,10,15,12,15,237,9,15,1,16,1,16,1,16,
        1,16,3,16,243,8,16,1,17,3,17,246,8,17,1,17,1,17,3,17,250,8,17,1,
        17,1,17,1,17,3,17,255,8,17,1,17,3,17,258,8,17,1,18,1,18,3,18,262,
        8,18,1,19,5,19,265,8,19,10,19,12,19,268,9,19,1,20,1,20,1,20,1,20,
        1,21,1,21,3,21,276,8,21,1,22,1,22,1,22,1,22,1,22,1,22,1,22,1,22,
        1,22,3,22,287,8,22,1,23,1,23,1,23,1,23,1,23,1,23,1,23,1,24,1,24,
        1,24,1,24,1,24,1,24,3,24,302,8,24,1,24,1,24,1,24,1,24,1,25,1,25,
        1,25,1,25,1,25,1,25,5,25,314,8,25,10,25,12,25,317,9,25,3,25,319,
        8,25,1,25,3,25,322,8,25,1,25,1,25,1,25,1,26,1,26,1,27,1,27,1,27,
        1,27,1,27,1,27,1,28,1,28,1,28,1,28,1,28,1,28,1,29,1,29,1,29,1,29,
        1,29,1,29,1,29,1,30,1,30,1,30,1,30,1,30,1,30,1,30,1,30,1,31,1,31,
        1,31,1,31,1,31,1,31,1,31,1,31,1,32,1,32,1,32,1,32,1,32,1,32,1,32,
        1,33,1,33,1,33,1,33,1,33,1,33,1,33,1,34,1,34,1,34,1,34,5,34,382,
        8,34,10,34,12,34,385,9,34,1,34,1,34,1,34,1,35,1,35,1,35,1,35,1,35,
        1,35,3,35,396,8,35,1,36,1,36,1,36,1,36,1,36,1,37,1,37,1,37,3,37,
        406,8,37,1,37,1,37,1,38,1,38,1,38,1,38,1,39,1,39,1,39,1,39,1,40,
        1,40,1,40,1,40,1,41,1,41,1,41,1,41,1,42,1,42,1,42,1,42,1,43,1,43,
        1,43,0,1,24,44,0,2,4,6,8,10,12,14,16,18,20,22,24,26,28,30,32,34,
        36,38,40,42,44,46,48,50,52,54,56,58,60,62,64,66,68,70,72,74,76,78,
        80,82,84,86,0,7,1,1,1,1,2,0,27,27,48,50,1,0,31,32,1,0,43,44,2,0,
        45,45,49,49,1,0,27,28,1,0,35,36,460,0,92,1,0,0,0,2,116,1,0,0,0,4,
        118,1,0,0,0,6,120,1,0,0,0,8,142,1,0,0,0,10,144,1,0,0,0,12,150,1,
        0,0,0,14,157,1,0,0,0,16,160,1,0,0,0,18,168,1,0,0,0,20,190,1,0,0,
        0,22,192,1,0,0,0,24,203,1,0,0,0,26,216,1,0,0,0,28,228,1,0,0,0,30,
        230,1,0,0,0,32,242,1,0,0,0,34,257,1,0,0,0,36,259,1,0,0,0,38,266,
        1,0,0,0,40,269,1,0,0,0,42,273,1,0,0,0,44,286,1,0,0,0,46,288,1,0,
        0,0,48,295,1,0,0,0,50,307,1,0,0,0,52,326,1,0,0,0,54,328,1,0,0,0,
        56,334,1,0,0,0,58,340,1,0,0,0,60,347,1,0,0,0,62,355,1,0,0,0,64,363,
        1,0,0,0,66,370,1,0,0,0,68,377,1,0,0,0,70,395,1,0,0,0,72,397,1,0,
        0,0,74,402,1,0,0,0,76,409,1,0,0,0,78,413,1,0,0,0,80,417,1,0,0,0,
        82,421,1,0,0,0,84,425,1,0,0,0,86,429,1,0,0,0,88,91,5,1,0,0,89,91,
        3,2,1,0,90,88,1,0,0,0,90,89,1,0,0,0,91,94,1,0,0,0,92,90,1,0,0,0,
        92,93,1,0,0,0,93,95,1,0,0,0,94,92,1,0,0,0,95,96,5,0,0,1,96,1,1,0,
        0,0,97,117,3,6,3,0,98,117,3,46,23,0,99,117,3,48,24,0,100,117,3,50,
        25,0,101,117,3,54,27,0,102,117,3,56,28,0,103,117,3,58,29,0,104,117,
        3,60,30,0,105,117,3,62,31,0,106,117,3,64,32,0,107,117,3,66,33,0,
        108,117,3,68,34,0,109,117,3,72,36,0,110,117,3,74,37,0,111,117,3,
        76,38,0,112,117,3,78,39,0,113,117,3,80,40,0,114,117,3,82,41,0,115,
        117,3,84,42,0,116,97,1,0,0,0,116,98,1,0,0,0,116,99,1,0,0,0,116,100,
        1,0,0,0,116,101,1,0,0,0,116,102,1,0,0,0,116,103,1,0,0,0,116,104,
        1,0,0,0,116,105,1,0,0,0,116,106,1,0,0,0,116,107,1,0,0,0,116,108,
        1,0,0,0,116,109,1,0,0,0,116,110,1,0,0,0,116,111,1,0,0,0,116,112,
        1,0,0,0,116,113,1,0,0,0,116,114,1,0,0,0,116,115,1,0,0,0,117,3,1,
        0,0,0,118,119,7,0,0,0,119,5,1,0,0,0,120,121,5,25,0,0,121,123,3,8,
        4,0,122,124,3,12,6,0,123,122,1,0,0,0,123,124,1,0,0,0,124,125,1,0,
        0,0,125,126,3,14,7,0,126,131,3,4,2,0,127,130,3,40,20,0,128,130,3,
        16,8,0,129,127,1,0,0,0,129,128,1,0,0,0,130,133,1,0,0,0,131,129,1,
        0,0,0,131,132,1,0,0,0,132,137,1,0,0,0,133,131,1,0,0,0,134,136,3,
        18,9,0,135,134,1,0,0,0,136,139,1,0,0,0,137,135,1,0,0,0,137,138,1,
        0,0,0,138,7,1,0,0,0,139,137,1,0,0,0,140,143,5,4,0,0,141,143,3,10,
        5,0,142,140,1,0,0,0,142,141,1,0,0,0,143,9,1,0,0,0,144,145,7,1,0,
        0,145,11,1,0,0,0,146,148,5,29,0,0,147,149,5,34,0,0,148,147,1,0,0,
        0,148,149,1,0,0,0,149,151,1,0,0,0,150,146,1,0,0,0,150,151,1,0,0,
        0,151,152,1,0,0,0,152,153,5,29,0,0,153,13,1,0,0,0,154,156,7,2,0,
        0,155,154,1,0,0,0,156,159,1,0,0,0,157,155,1,0,0,0,157,158,1,0,0,
        0,158,15,1,0,0,0,159,157,1,0,0,0,160,162,5,51,0,0,161,163,7,2,0,
        0,162,161,1,0,0,0,163,164,1,0,0,0,164,162,1,0,0,0,164,165,1,0,0,
        0,165,166,1,0,0,0,166,167,3,4,2,0,167,17,1,0,0,0,168,170,5,51,0,
        0,169,171,3,10,5,0,170,169,1,0,0,0,170,171,1,0,0,0,171,172,1,0,0,
        0,172,174,3,86,43,0,173,175,3,20,10,0,174,173,1,0,0,0,174,175,1,
        0,0,0,175,177,1,0,0,0,176,178,3,28,14,0,177,176,1,0,0,0,177,178,
        1,0,0,0,178,180,1,0,0,0,179,181,3,36,18,0,180,179,1,0,0,0,180,181,
        1,0,0,0,181,182,1,0,0,0,182,183,3,4,2,0,183,184,3,38,19,0,184,19,
        1,0,0,0,185,187,3,24,12,0,186,188,3,26,13,0,187,186,1,0,0,0,187,
        188,1,0,0,0,188,191,1,0,0,0,189,191,3,26,13,0,190,185,1,0,0,0,190,
        189,1,0,0,0,191,21,1,0,0,0,192,193,3,24,12,0,193,194,3,26,13,0,194,
        23,1,0,0,0,195,196,6,12,-1,0,196,204,5,30,0,0,197,198,5,46,0,0,198,
        199,3,24,12,0,199,200,5,47,0,0,200,204,1,0,0,0,201,202,7,3,0,0,202,
        204,3,24,12,3,203,195,1,0,0,0,203,197,1,0,0,0,203,201,1,0,0,0,204,
        213,1,0,0,0,205,206,10,2,0,0,206,207,7,4,0,0,207,212,3,24,12,3,208,
        209,10,1,0,0,209,210,7,3,0,0,210,212,3,24,12,2,211,205,1,0,0,0,211,
        208,1,0,0,0,212,215,1,0,0,0,213,211,1,0,0,0,213,214,1,0,0,0,214,
        25,1,0,0,0,215,213,1,0,0,0,216,217,7,5,0,0,217,27,1,0,0,0,218,220,
        5,39,0,0,219,221,3,30,15,0,220,219,1,0,0,0,220,221,1,0,0,0,221,222,
        1,0,0,0,222,229,5,40,0,0,223,225,5,37,0,0,224,226,3,30,15,0,225,
        224,1,0,0,0,225,226,1,0,0,0,226,227,1,0,0,0,227,229,5,38,0,0,228,
        218,1,0,0,0,228,223,1,0,0,0,229,29,1,0,0,0,230,235,3,32,16,0,231,
        232,5,41,0,0,232,234,3,32,16,0,233,231,1,0,0,0,234,237,1,0,0,0,235,
        233,1,0,0,0,235,236,1,0,0,0,236,31,1,0,0,0,237,235,1,0,0,0,238,243,
        3,34,17,0,239,243,5,25,0,0,240,243,5,29,0,0,241,243,5,49,0,0,242,
        238,1,0,0,0,242,239,1,0,0,0,242,240,1,0,0,0,242,241,1,0,0,0,243,
        33,1,0,0,0,244,246,3,24,12,0,245,244,1,0,0,0,245,246,1,0,0,0,246,
        247,1,0,0,0,247,249,5,48,0,0,248,250,3,24,12,0,249,248,1,0,0,0,249,
        250,1,0,0,0,250,251,1,0,0,0,251,258,3,26,13,0,252,254,3,24,12,0,
        253,255,3,26,13,0,254,253,1,0,0,0,254,255,1,0,0,0,255,258,1,0,0,
        0,256,258,3,26,13,0,257,245,1,0,0,0,257,252,1,0,0,0,257,256,1,0,
        0,0,258,35,1,0,0,0,259,261,7,6,0,0,260,262,3,20,10,0,261,260,1,0,
        0,0,261,262,1,0,0,0,262,37,1,0,0,0,263,265,3,40,20,0,264,263,1,0,
        0,0,265,268,1,0,0,0,266,264,1,0,0,0,266,267,1,0,0,0,267,39,1,0,0,
        0,268,266,1,0,0,0,269,270,5,51,0,0,270,271,3,42,21,0,271,272,3,4,
        2,0,272,41,1,0,0,0,273,275,5,33,0,0,274,276,3,44,22,0,275,274,1,
        0,0,0,275,276,1,0,0,0,276,43,1,0,0,0,277,287,5,29,0,0,278,287,3,
        86,43,0,279,287,5,25,0,0,280,287,3,26,13,0,281,287,5,31,0,0,282,
        287,5,23,0,0,283,287,5,24,0,0,284,287,3,22,11,0,285,287,3,24,12,
        0,286,277,1,0,0,0,286,278,1,0,0,0,286,279,1,0,0,0,286,280,1,0,0,
        0,286,281,1,0,0,0,286,282,1,0,0,0,286,283,1,0,0,0,286,284,1,0,0,
        0,286,285,1,0,0,0,287,45,1,0,0,0,288,289,5,25,0,0,289,290,5,13,0,
        0,290,291,3,26,13,0,291,292,3,22,11,0,292,293,3,4,2,0,293,294,3,
        38,19,0,294,47,1,0,0,0,295,296,5,25,0,0,296,297,5,5,0,0,297,298,
        3,86,43,0,298,301,3,24,12,0,299,300,5,42,0,0,300,302,3,24,12,0,301,
        299,1,0,0,0,301,302,1,0,0,0,302,303,1,0,0,0,303,304,3,26,13,0,304,
        305,3,4,2,0,305,306,3,38,19,0,306,49,1,0,0,0,307,308,5,25,0,0,308,
        309,5,6,0,0,309,318,3,86,43,0,310,315,3,26,13,0,311,312,5,41,0,0,
        312,314,3,26,13,0,313,311,1,0,0,0,314,317,1,0,0,0,315,313,1,0,0,
        0,315,316,1,0,0,0,316,319,1,0,0,0,317,315,1,0,0,0,318,310,1,0,0,
        0,318,319,1,0,0,0,319,321,1,0,0,0,320,322,3,52,26,0,321,320,1,0,
        0,0,321,322,1,0,0,0,322,323,1,0,0,0,323,324,3,4,2,0,324,325,3,38,
        19,0,325,51,1,0,0,0,326,327,5,29,0,0,327,53,1,0,0,0,328,329,5,25,
        0,0,329,330,5,7,0,0,330,331,3,86,43,0,331,332,3,4,2,0,332,333,3,
        38,19,0,333,55,1,0,0,0,334,335,5,25,0,0,335,336,5,8,0,0,336,337,
        3,26,13,0,337,338,3,4,2,0,338,339,3,38,19,0,339,57,1,0,0,0,340,341,
        5,25,0,0,341,342,5,9,0,0,342,343,3,86,43,0,343,344,3,86,43,0,344,
        345,3,4,2,0,345,346,3,38,19,0,346,59,1,0,0,0,347,348,5,25,0,0,348,
        349,5,14,0,0,349,350,3,86,43,0,350,351,5,29,0,0,351,352,3,14,7,0,
        352,353,3,4,2,0,353,354,3,38,19,0,354,61,1,0,0,0,355,356,5,25,0,
        0,356,357,5,15,0,0,357,358,3,86,43,0,358,359,5,29,0,0,359,360,3,
        14,7,0,360,361,3,4,2,0,361,362,3,38,19,0,362,63,1,0,0,0,363,364,
        5,25,0,0,364,365,5,10,0,0,365,366,5,29,0,0,366,367,5,29,0,0,367,
        368,3,4,2,0,368,369,3,38,19,0,369,65,1,0,0,0,370,371,5,25,0,0,371,
        372,5,11,0,0,372,373,5,29,0,0,373,374,5,29,0,0,374,375,3,4,2,0,375,
        376,3,38,19,0,376,67,1,0,0,0,377,378,5,25,0,0,378,379,5,12,0,0,379,
        383,5,29,0,0,380,382,3,70,35,0,381,380,1,0,0,0,382,385,1,0,0,0,383,
        381,1,0,0,0,383,384,1,0,0,0,384,386,1,0,0,0,385,383,1,0,0,0,386,
        387,3,4,2,0,387,388,3,38,19,0,388,69,1,0,0,0,389,396,5,29,0,0,390,
        396,5,25,0,0,391,396,5,23,0,0,392,396,3,22,11,0,393,396,3,24,12,
        0,394,396,3,86,43,0,395,389,1,0,0,0,395,390,1,0,0,0,395,391,1,0,
        0,0,395,392,1,0,0,0,395,393,1,0,0,0,395,394,1,0,0,0,396,71,1,0,0,
        0,397,398,5,20,0,0,398,399,5,29,0,0,399,400,5,29,0,0,400,401,3,4,
        2,0,401,73,1,0,0,0,402,403,5,21,0,0,403,405,5,29,0,0,404,406,5,29,
        0,0,405,404,1,0,0,0,405,406,1,0,0,0,406,407,1,0,0,0,407,408,3,4,
        2,0,408,75,1,0,0,0,409,410,5,22,0,0,410,411,5,29,0,0,411,412,3,4,
        2,0,412,77,1,0,0,0,413,414,5,16,0,0,414,415,5,31,0,0,415,416,3,4,
        2,0,416,79,1,0,0,0,417,418,5,17,0,0,418,419,5,31,0,0,419,420,3,4,
        2,0,420,81,1,0,0,0,421,422,5,18,0,0,422,423,3,42,21,0,423,424,3,
        4,2,0,424,83,1,0,0,0,425,426,5,19,0,0,426,427,5,33,0,0,427,428,3,
        4,2,0,428,85,1,0,0,0,429,430,5,26,0,0,430,87,1,0,0,0,41,90,92,116,
        123,129,131,137,142,148,150,157,164,170,174,177,180,187,190,203,
        211,213,220,225,228,235,242,245,249,254,257,261,266,275,286,301,
        315,318,321,383,395,405
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
    public EOL(): antlr.TerminalNode[];
    public EOL(i: number): antlr.TerminalNode | null;
    public EOL(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(BeancountParser.EOL);
    	} else {
    		return this.getToken(BeancountParser.EOL, i);
    	}
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
    public pushtag(): PushtagContext | null {
        return this.getRuleContext(0, PushtagContext);
    }
    public poptag(): PoptagContext | null {
        return this.getRuleContext(0, PoptagContext);
    }
    public pushmeta(): PushmetaContext | null {
        return this.getRuleContext(0, PushmetaContext);
    }
    public popmeta(): PopmetaContext | null {
        return this.getRuleContext(0, PopmetaContext);
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


export class EolContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public EOL(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.EOL, 0);
    }
    public EOF(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.EOF, 0);
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_eol;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitEol) {
            return visitor.visitEol(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class TransactionContext extends antlr.ParserRuleContext {
    public _txnFlag?: Txn_flagContext;
    public _strings?: Txn_stringsContext;
    public _tagsLinks?: Tags_linksContext;
    public _key_value_line?: Key_value_lineContext;
    public _meta: Key_value_lineContext[] = [];
    public _tags_links_line?: Tags_links_lineContext;
    public _tagLines: Tags_links_lineContext[] = [];
    public _posting?: PostingContext;
    public _postings: PostingContext[] = [];
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public DATE(): antlr.TerminalNode {
        return this.getToken(BeancountParser.DATE, 0)!;
    }
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
    }
    public txn_flag(): Txn_flagContext {
        return this.getRuleContext(0, Txn_flagContext)!;
    }
    public tags_links(): Tags_linksContext {
        return this.getRuleContext(0, Tags_linksContext)!;
    }
    public txn_strings(): Txn_stringsContext | null {
        return this.getRuleContext(0, Txn_stringsContext);
    }
    public key_value_line(): Key_value_lineContext[];
    public key_value_line(i: number): Key_value_lineContext | null;
    public key_value_line(i?: number): Key_value_lineContext[] | Key_value_lineContext | null {
        if (i === undefined) {
            return this.getRuleContexts(Key_value_lineContext);
        }

        return this.getRuleContext(i, Key_value_lineContext);
    }
    public tags_links_line(): Tags_links_lineContext[];
    public tags_links_line(i: number): Tags_links_lineContext | null;
    public tags_links_line(i?: number): Tags_links_lineContext[] | Tags_links_lineContext | null {
        if (i === undefined) {
            return this.getRuleContexts(Tags_links_lineContext);
        }

        return this.getRuleContext(i, Tags_links_lineContext);
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
    public flag(): FlagContext | null {
        return this.getRuleContext(0, FlagContext);
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


export class FlagContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public ASTERISK(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.ASTERISK, 0);
    }
    public HASH(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.HASH, 0);
    }
    public FLAG(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.FLAG, 0);
    }
    public CAPITAL(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.CAPITAL, 0);
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_flag;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitFlag) {
            return visitor.visitFlag(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class Txn_stringsContext extends antlr.ParserRuleContext {
    public _payee?: Token | null;
    public _narration?: Token | null;
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
    public PIPE(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.PIPE, 0);
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_txn_strings;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitTxn_strings) {
            return visitor.visitTxn_strings(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class Tags_linksContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
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
        return BeancountParser.RULE_tags_links;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitTags_links) {
            return visitor.visitTags_links(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class Tags_links_lineContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public INDENT(): antlr.TerminalNode {
        return this.getToken(BeancountParser.INDENT, 0)!;
    }
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
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
        return BeancountParser.RULE_tags_links_line;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitTags_links_line) {
            return visitor.visitTags_links_line(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class PostingContext extends antlr.ParserRuleContext {
    public _postingFlag?: FlagContext;
    public _acct?: AccountContext;
    public _units?: Incomplete_amountContext;
    public _costSpec?: CostContext;
    public _priceSpec?: Price_annotationContext;
    public _meta?: MetadataContext;
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public INDENT(): antlr.TerminalNode {
        return this.getToken(BeancountParser.INDENT, 0)!;
    }
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
    }
    public account(): AccountContext {
        return this.getRuleContext(0, AccountContext)!;
    }
    public metadata(): MetadataContext {
        return this.getRuleContext(0, MetadataContext)!;
    }
    public flag(): FlagContext | null {
        return this.getRuleContext(0, FlagContext);
    }
    public incomplete_amount(): Incomplete_amountContext | null {
        return this.getRuleContext(0, Incomplete_amountContext);
    }
    public cost(): CostContext | null {
        return this.getRuleContext(0, CostContext);
    }
    public price_annotation(): Price_annotationContext | null {
        return this.getRuleContext(0, Price_annotationContext);
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


export class Incomplete_amountContext extends antlr.ParserRuleContext {
    public _num?: NumberContext;
    public _cur?: CommodityContext;
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public number(): NumberContext | null {
        return this.getRuleContext(0, NumberContext);
    }
    public commodity(): CommodityContext | null {
        return this.getRuleContext(0, CommodityContext);
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_incomplete_amount;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitIncomplete_amount) {
            return visitor.visitIncomplete_amount(this);
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
    public NUMBER(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.NUMBER, 0);
    }
    public LPAREN(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.LPAREN, 0);
    }
    public number_(): NumberContext[];
    public number_(i: number): NumberContext | null;
    public number_(i?: number): NumberContext[] | NumberContext | null {
        if (i === undefined) {
            return this.getRuleContexts(NumberContext);
        }

        return this.getRuleContext(i, NumberContext);
    }
    public RPAREN(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.RPAREN, 0);
    }
    public MINUS(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.MINUS, 0);
    }
    public PLUS(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.PLUS, 0);
    }
    public ASTERISK(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.ASTERISK, 0);
    }
    public SLASH(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.SLASH, 0);
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
    public CURRENCY(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.CURRENCY, 0);
    }
    public CAPITAL(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.CAPITAL, 0);
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
    public LCURL(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.LCURL, 0);
    }
    public RCURL(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.RCURL, 0);
    }
    public cost_comp_list(): Cost_comp_listContext | null {
        return this.getRuleContext(0, Cost_comp_listContext);
    }
    public LCURLCURL(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.LCURLCURL, 0);
    }
    public RCURLCURL(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.RCURLCURL, 0);
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


export class Cost_comp_listContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public cost_comp(): Cost_compContext[];
    public cost_comp(i: number): Cost_compContext | null;
    public cost_comp(i?: number): Cost_compContext[] | Cost_compContext | null {
        if (i === undefined) {
            return this.getRuleContexts(Cost_compContext);
        }

        return this.getRuleContext(i, Cost_compContext);
    }
    public COMMA(): antlr.TerminalNode[];
    public COMMA(i: number): antlr.TerminalNode | null;
    public COMMA(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(BeancountParser.COMMA);
    	} else {
    		return this.getToken(BeancountParser.COMMA, i);
    	}
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_cost_comp_list;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitCost_comp_list) {
            return visitor.visitCost_comp_list(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class Cost_compContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public compound_amount(): Compound_amountContext | null {
        return this.getRuleContext(0, Compound_amountContext);
    }
    public DATE(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.DATE, 0);
    }
    public STRING(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.STRING, 0);
    }
    public ASTERISK(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.ASTERISK, 0);
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_cost_comp;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitCost_comp) {
            return visitor.visitCost_comp(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class Compound_amountContext extends antlr.ParserRuleContext {
    public _perUnit?: NumberContext;
    public _total?: NumberContext;
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public HASH(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.HASH, 0);
    }
    public commodity(): CommodityContext | null {
        return this.getRuleContext(0, CommodityContext);
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
        return BeancountParser.RULE_compound_amount;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitCompound_amount) {
            return visitor.visitCompound_amount(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class Price_annotationContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public AT(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.AT, 0);
    }
    public ATAT(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.ATAT, 0);
    }
    public incomplete_amount(): Incomplete_amountContext | null {
        return this.getRuleContext(0, Incomplete_amountContext);
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
    public _key_value_line?: Key_value_lineContext;
    public _lines: Key_value_lineContext[] = [];
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public key_value_line(): Key_value_lineContext[];
    public key_value_line(i: number): Key_value_lineContext | null;
    public key_value_line(i?: number): Key_value_lineContext[] | Key_value_lineContext | null {
        if (i === undefined) {
            return this.getRuleContexts(Key_value_lineContext);
        }

        return this.getRuleContext(i, Key_value_lineContext);
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


export class Key_value_lineContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public INDENT(): antlr.TerminalNode {
        return this.getToken(BeancountParser.INDENT, 0)!;
    }
    public key_value(): Key_valueContext {
        return this.getRuleContext(0, Key_valueContext)!;
    }
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_key_value_line;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitKey_value_line) {
            return visitor.visitKey_value_line(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class Key_valueContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public KEY(): antlr.TerminalNode {
        return this.getToken(BeancountParser.KEY, 0)!;
    }
    public key_value_value(): Key_value_valueContext | null {
        return this.getRuleContext(0, Key_value_valueContext);
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_key_value;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitKey_value) {
            return visitor.visitKey_value(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class Key_value_valueContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public STRING(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.STRING, 0);
    }
    public account(): AccountContext | null {
        return this.getRuleContext(0, AccountContext);
    }
    public DATE(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.DATE, 0);
    }
    public commodity(): CommodityContext | null {
        return this.getRuleContext(0, CommodityContext);
    }
    public TAG(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.TAG, 0);
    }
    public BOOL(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.BOOL, 0);
    }
    public NONE(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.NONE, 0);
    }
    public amount(): AmountContext | null {
        return this.getRuleContext(0, AmountContext);
    }
    public number(): NumberContext | null {
        return this.getRuleContext(0, NumberContext);
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_key_value_value;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitKey_value_value) {
            return visitor.visitKey_value_value(this);
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
    public PRICE(): antlr.TerminalNode {
        return this.getToken(BeancountParser.PRICE, 0)!;
    }
    public commodity(): CommodityContext {
        return this.getRuleContext(0, CommodityContext)!;
    }
    public amount(): AmountContext {
        return this.getRuleContext(0, AmountContext)!;
    }
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
    }
    public metadata(): MetadataContext {
        return this.getRuleContext(0, MetadataContext)!;
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
    public _balanceNumber?: NumberContext;
    public _tolerance?: NumberContext;
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public DATE(): antlr.TerminalNode {
        return this.getToken(BeancountParser.DATE, 0)!;
    }
    public BALANCE(): antlr.TerminalNode {
        return this.getToken(BeancountParser.BALANCE, 0)!;
    }
    public account(): AccountContext {
        return this.getRuleContext(0, AccountContext)!;
    }
    public commodity(): CommodityContext {
        return this.getRuleContext(0, CommodityContext)!;
    }
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
    }
    public metadata(): MetadataContext {
        return this.getRuleContext(0, MetadataContext)!;
    }
    public number_(): NumberContext[];
    public number_(i: number): NumberContext | null;
    public number_(i?: number): NumberContext[] | NumberContext | null {
        if (i === undefined) {
            return this.getRuleContexts(NumberContext);
        }

        return this.getRuleContext(i, NumberContext);
    }
    public TILDE(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.TILDE, 0);
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
    public OPEN(): antlr.TerminalNode {
        return this.getToken(BeancountParser.OPEN, 0)!;
    }
    public account(): AccountContext {
        return this.getRuleContext(0, AccountContext)!;
    }
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
    }
    public metadata(): MetadataContext {
        return this.getRuleContext(0, MetadataContext)!;
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
    public COMMA(): antlr.TerminalNode[];
    public COMMA(i: number): antlr.TerminalNode | null;
    public COMMA(i?: number): antlr.TerminalNode | null | antlr.TerminalNode[] {
    	if (i === undefined) {
    		return this.getTokens(BeancountParser.COMMA);
    	} else {
    		return this.getToken(BeancountParser.COMMA, i);
    	}
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
    public CLOSE(): antlr.TerminalNode {
        return this.getToken(BeancountParser.CLOSE, 0)!;
    }
    public account(): AccountContext {
        return this.getRuleContext(0, AccountContext)!;
    }
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
    }
    public metadata(): MetadataContext {
        return this.getRuleContext(0, MetadataContext)!;
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
    public commodity(): CommodityContext {
        return this.getRuleContext(0, CommodityContext)!;
    }
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
    }
    public metadata(): MetadataContext {
        return this.getRuleContext(0, MetadataContext)!;
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
    public PAD(): antlr.TerminalNode {
        return this.getToken(BeancountParser.PAD, 0)!;
    }
    public account(): AccountContext[];
    public account(i: number): AccountContext | null;
    public account(i?: number): AccountContext[] | AccountContext | null {
        if (i === undefined) {
            return this.getRuleContexts(AccountContext);
        }

        return this.getRuleContext(i, AccountContext);
    }
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
    }
    public metadata(): MetadataContext {
        return this.getRuleContext(0, MetadataContext)!;
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
    public NOTE(): antlr.TerminalNode {
        return this.getToken(BeancountParser.NOTE, 0)!;
    }
    public account(): AccountContext {
        return this.getRuleContext(0, AccountContext)!;
    }
    public STRING(): antlr.TerminalNode {
        return this.getToken(BeancountParser.STRING, 0)!;
    }
    public tags_links(): Tags_linksContext {
        return this.getRuleContext(0, Tags_linksContext)!;
    }
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
    }
    public metadata(): MetadataContext {
        return this.getRuleContext(0, MetadataContext)!;
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
    public DOCUMENT(): antlr.TerminalNode {
        return this.getToken(BeancountParser.DOCUMENT, 0)!;
    }
    public account(): AccountContext {
        return this.getRuleContext(0, AccountContext)!;
    }
    public STRING(): antlr.TerminalNode {
        return this.getToken(BeancountParser.STRING, 0)!;
    }
    public tags_links(): Tags_linksContext {
        return this.getRuleContext(0, Tags_linksContext)!;
    }
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
    }
    public metadata(): MetadataContext {
        return this.getRuleContext(0, MetadataContext)!;
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
    public EVENT(): antlr.TerminalNode {
        return this.getToken(BeancountParser.EVENT, 0)!;
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
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
    }
    public metadata(): MetadataContext {
        return this.getRuleContext(0, MetadataContext)!;
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
    public QUERY(): antlr.TerminalNode {
        return this.getToken(BeancountParser.QUERY, 0)!;
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
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
    }
    public metadata(): MetadataContext {
        return this.getRuleContext(0, MetadataContext)!;
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
    public DATE(): antlr.TerminalNode {
        return this.getToken(BeancountParser.DATE, 0)!;
    }
    public CUSTOM(): antlr.TerminalNode {
        return this.getToken(BeancountParser.CUSTOM, 0)!;
    }
    public STRING(): antlr.TerminalNode {
        return this.getToken(BeancountParser.STRING, 0)!;
    }
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
    }
    public metadata(): MetadataContext {
        return this.getRuleContext(0, MetadataContext)!;
    }
    public custom_value(): Custom_valueContext[];
    public custom_value(i: number): Custom_valueContext | null;
    public custom_value(i?: number): Custom_valueContext[] | Custom_valueContext | null {
        if (i === undefined) {
            return this.getRuleContexts(Custom_valueContext);
        }

        return this.getRuleContext(i, Custom_valueContext);
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


export class Custom_valueContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public STRING(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.STRING, 0);
    }
    public DATE(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.DATE, 0);
    }
    public BOOL(): antlr.TerminalNode | null {
        return this.getToken(BeancountParser.BOOL, 0);
    }
    public amount(): AmountContext | null {
        return this.getRuleContext(0, AmountContext);
    }
    public number(): NumberContext | null {
        return this.getRuleContext(0, NumberContext);
    }
    public account(): AccountContext | null {
        return this.getRuleContext(0, AccountContext);
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_custom_value;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitCustom_value) {
            return visitor.visitCustom_value(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class OptionsContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public OPTION(): antlr.TerminalNode {
        return this.getToken(BeancountParser.OPTION, 0)!;
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
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
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
    public PLUGIN(): antlr.TerminalNode {
        return this.getToken(BeancountParser.PLUGIN, 0)!;
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
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
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
    public INCLUDE(): antlr.TerminalNode {
        return this.getToken(BeancountParser.INCLUDE, 0)!;
    }
    public STRING(): antlr.TerminalNode {
        return this.getToken(BeancountParser.STRING, 0)!;
    }
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
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


export class PushtagContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public PUSHTAG(): antlr.TerminalNode {
        return this.getToken(BeancountParser.PUSHTAG, 0)!;
    }
    public TAG(): antlr.TerminalNode {
        return this.getToken(BeancountParser.TAG, 0)!;
    }
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_pushtag;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitPushtag) {
            return visitor.visitPushtag(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class PoptagContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public POPTAG(): antlr.TerminalNode {
        return this.getToken(BeancountParser.POPTAG, 0)!;
    }
    public TAG(): antlr.TerminalNode {
        return this.getToken(BeancountParser.TAG, 0)!;
    }
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_poptag;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitPoptag) {
            return visitor.visitPoptag(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class PushmetaContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public PUSHMETA(): antlr.TerminalNode {
        return this.getToken(BeancountParser.PUSHMETA, 0)!;
    }
    public key_value(): Key_valueContext {
        return this.getRuleContext(0, Key_valueContext)!;
    }
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_pushmeta;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitPushmeta) {
            return visitor.visitPushmeta(this);
        } else {
            return visitor.visitChildren(this);
        }
    }
}


export class PopmetaContext extends antlr.ParserRuleContext {
    public constructor(parent: antlr.ParserRuleContext | null, invokingState: number) {
        super(parent, invokingState);
    }
    public POPMETA(): antlr.TerminalNode {
        return this.getToken(BeancountParser.POPMETA, 0)!;
    }
    public KEY(): antlr.TerminalNode {
        return this.getToken(BeancountParser.KEY, 0)!;
    }
    public eol(): EolContext {
        return this.getRuleContext(0, EolContext)!;
    }
    public override get ruleIndex(): number {
        return BeancountParser.RULE_popmeta;
    }
    public override accept<Result>(visitor: BeancountVisitor<Result>): Result | null {
        if (visitor.visitPopmeta) {
            return visitor.visitPopmeta(this);
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
