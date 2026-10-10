// Model classes for Beancount data structures

// `null` is a key with no value (`key:`) or an explicit `NULL`.
export type MetadataValue = string | Date | number | boolean | Amount | null;

export interface Metadata {
  [key: string]: MetadataValue;
}

export interface Position {
  line: number;
  column: number;
}

export interface SourceLocation {
  start: Position;
  end: Position;
}

export abstract class DirectiveBase {
  location?: SourceLocation;
  metadata: Metadata = {};

  constructor(location?: SourceLocation, metadata: Metadata = {}) {
    this.location = location;
    this.metadata = metadata;
  }
}

export class Transaction extends DirectiveBase {
  date: Date;
  flag: string;
  payee: string | null;
  narration: string | null;
  postings: Posting[];
  tags: string[];
  links: string[];

  constructor(
    date: Date,
    flag: string,
    payee: string | null,
    narration: string | null,
    postings: Posting[] = [],
    location?: SourceLocation,
    metadata: Metadata = {},
    tags: string[] = [],
    links: string[] = []
  ) {
    super(location, metadata);
    this.date = date;
    this.flag = flag;
    this.payee = payee;
    this.narration = narration;
    this.postings = postings;
    this.tags = tags;
    this.links = links;
  }
}

export class Amount {
  number: number;
  currency: string;
  /**
   * Source spelling when `number` is a plain literal: sign kept, thousands
   * separators removed. Absent when the number came from an arithmetic expression.
   */
  numberText?: string;

  constructor(number: number, currency: string, numberText?: string) {
    this.number = number;
    this.currency = currency;
    if (numberText !== undefined) this.numberText = numberText;
  }

  toString(): string {
    return `${this.number} ${this.currency}`;
  }
}

// A posting or price amount with the number or the currency left out, to be
// filled in by interpolation. At least one of the two is present.
export class IncompleteAmount {
  number: number | null;
  currency: string | null;
  /** Same spelling as `Amount.numberText`, when the number is a plain literal. */
  numberText?: string;

  constructor(number: number | null, currency: string | null, numberText?: string) {
    this.number = number;
    this.currency = currency;
    if (numberText !== undefined) this.numberText = numberText;
  }
}

// `{amount}` is per-unit, `{{total}}` is total; `{per # total CUR}` sets both.
// `merge` is the `*` component.
export class Cost {
  amount?: Amount | IncompleteAmount;
  total?: Amount | IncompleteAmount;
  date?: Date;
  label?: string;
  merge: boolean;

  constructor(
    amount?: Amount | IncompleteAmount,
    date?: Date,
    label?: string,
    total?: Amount | IncompleteAmount,
    merge: boolean = false
  ) {
    this.amount = amount;
    this.date = date;
    this.label = label;
    this.total = total;
    this.merge = merge;
  }
}

// `@` is per-unit, `@@` is total. A bare `@` has no amount.
export class PriceAnnotation {
  amount?: Amount | IncompleteAmount;
  isTotal: boolean;

  constructor(amount?: Amount | IncompleteAmount, isTotal: boolean = false) {
    this.amount = amount;
    this.isTotal = isTotal;
  }
}

export class Posting extends DirectiveBase {
  account: string;
  amount?: Amount | IncompleteAmount;
  cost?: Cost;
  priceAnnotation?: PriceAnnotation;
  flag?: string;

  constructor(
    account: string,
    amount?: Amount | IncompleteAmount,
    cost?: Cost,
    priceAnnotation?: PriceAnnotation,
    location?: SourceLocation,
    metadata: Metadata = {},
    flag?: string
  ) {
    super(location, metadata);
    this.account = account;
    this.amount = amount;
    this.cost = cost;
    this.priceAnnotation = priceAnnotation;
    this.flag = flag;
  }
}

export class Price extends DirectiveBase {
  date: Date;
  currency: string;
  amount: Amount;

  constructor(
    date: Date,
    currency: string,
    amount: Amount,
    location?: SourceLocation,
    metadata: Metadata = {}
  ) {
    super(location, metadata);
    this.date = date;
    this.currency = currency;
    this.amount = amount;
  }
}

export class Balance extends DirectiveBase {
  date: Date;
  account: string;
  amount: Amount;
  tolerance?: number;
  /** Source spelling of an explicit tolerance, when that number is a plain literal. */
  toleranceText?: string;

  constructor(
    date: Date,
    account: string,
    amount: Amount,
    location?: SourceLocation,
    metadata: Metadata = {},
    tolerance?: number,
    toleranceText?: string
  ) {
    super(location, metadata);
    this.date = date;
    this.account = account;
    this.amount = amount;
    this.tolerance = tolerance;
    if (toleranceText !== undefined) this.toleranceText = toleranceText;
  }
}

export class Open extends DirectiveBase {
  date: Date;
  account: string;
  currencies: string[];
  booking?: string;

  constructor(
    date: Date,
    account: string,
    currencies: string[] = [],
    booking?: string,
    location?: SourceLocation,
    metadata: Metadata = {}
  ) {
    super(location, metadata);
    this.date = date;
    this.account = account;
    this.currencies = currencies;
    this.booking = booking;
  }
}

export class Close extends DirectiveBase {
  date: Date;
  account: string;

  constructor(
    date: Date,
    account: string,
    location?: SourceLocation,
    metadata: Metadata = {}
  ) {
    super(location, metadata);
    this.date = date;
    this.account = account;
  }
}

export class Commodity extends DirectiveBase {
  date: Date;
  currency: string;

  constructor(
    date: Date,
    currency: string,
    location?: SourceLocation,
    metadata: Metadata = {}
  ) {
    super(location, metadata);
    this.date = date;
    this.currency = currency;
  }
}

export class Pad extends DirectiveBase {
  date: Date;
  account: string;
  sourceAccount: string;

  constructor(
    date: Date,
    account: string,
    sourceAccount: string,
    location?: SourceLocation,
    metadata: Metadata = {}
  ) {
    super(location, metadata);
    this.date = date;
    this.account = account;
    this.sourceAccount = sourceAccount;
  }
}

export class Note extends DirectiveBase {
  date: Date;
  account: string;
  comment: string;
  tags: string[];
  links: string[];

  constructor(
    date: Date,
    account: string,
    comment: string,
    location?: SourceLocation,
    metadata: Metadata = {},
    tags: string[] = [],
    links: string[] = []
  ) {
    super(location, metadata);
    this.date = date;
    this.account = account;
    this.comment = comment;
    this.tags = tags;
    this.links = links;
  }
}

export class Document extends DirectiveBase {
  date: Date;
  account: string;
  path: string;
  tags: string[];
  links: string[];

  constructor(
    date: Date,
    account: string,
    path: string,
    location?: SourceLocation,
    metadata: Metadata = {},
    tags: string[] = [],
    links: string[] = []
  ) {
    super(location, metadata);
    this.date = date;
    this.account = account;
    this.path = path;
    this.tags = tags;
    this.links = links;
  }
}

export class Event extends DirectiveBase {
  date: Date;
  type: string;
  description: string;

  constructor(
    date: Date,
    type: string,
    description: string,
    location?: SourceLocation,
    metadata: Metadata = {}
  ) {
    super(location, metadata);
    this.date = date;
    this.type = type;
    this.description = description;
  }
}

export class Query extends DirectiveBase {
  date: Date;
  name: string;
  query: string;

  constructor(
    date: Date,
    name: string,
    query: string,
    location?: SourceLocation,
    metadata: Metadata = {}
  ) {
    super(location, metadata);
    this.date = date;
    this.name = name;
    this.query = query;
  }
}

export type CustomValue = string | Date | number | boolean | Amount;

export class Custom extends DirectiveBase {
  date: Date;
  type: string;
  values: CustomValue[];

  constructor(
    date: Date,
    type: string,
    values: CustomValue[] = [],
    location?: SourceLocation,
    metadata: Metadata = {}
  ) {
    super(location, metadata);
    this.date = date;
    this.type = type;
    this.values = values;
  }
}

export class Option extends DirectiveBase {
  name: string;
  value: string;

  constructor(
    name: string,
    value: string,
    location?: SourceLocation,
    metadata: Metadata = {}
  ) {
    super(location, metadata);
    this.name = name;
    this.value = value;
  }
}

export class Plugin extends DirectiveBase {
  name: string;
  config?: string;

  constructor(
    name: string,
    config?: string,
    location?: SourceLocation,
    metadata: Metadata = {}
  ) {
    super(location, metadata);
    this.name = name;
    this.config = config;
  }
}

export class Include extends DirectiveBase {
  filename: string;

  constructor(
    filename: string,
    location?: SourceLocation,
    metadata: Metadata = {}
  ) {
    super(location, metadata);
    this.filename = filename;
  }
}

export type Directive =
  | Transaction
  | Price
  | Balance
  | Open
  | Close
  | Commodity
  | Pad
  | Note
  | Document
  | Event
  | Query
  | Custom
  | Option
  | Plugin
  | Include;

export class BeancountFile {
  directives: Directive[] = [];

  constructor(directives: Directive[] = []) {
    this.directives = directives;
  }
}