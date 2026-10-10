import { expect, test, describe } from "bun:test";
import { BeancountParser } from "../src";
import { 
  Transaction, 
  Open, 
  Close, 
  Balance, 
  Price, 
  Note,
  Commodity,
  Amount,
  Posting
} from "../src/model";

describe("BeancountParser", () => {
  test("parses a simple transaction", () => {
    const input = `
2022-01-15 * "Grocery store" "Weekly groceries"
  Assets:Checking  -85.00 USD
  Expenses:Food     85.00 USD
`;
    
    const result = BeancountParser.parse(input);
    
    expect(result.directives.length).toBe(1);
    expect(result.directives[0]).toBeInstanceOf(Transaction);
    
    const txn = result.directives[0] as Transaction;
    expect(txn.date.getFullYear()).toBe(2022);
    expect(txn.date.getMonth()).toBe(0); // January is 0
    expect(txn.date.getDate()).toBe(15);
    expect(txn.flag).toBe('*');
    expect(txn.payee).toBe('Grocery store');
    expect(txn.narration).toBe('Weekly groceries');
    
    expect(txn.postings.length).toBe(2);
    
    expect(txn.postings[0].account).toBe('Assets:Checking');
    expect(txn.postings[0].amount?.number).toBe(-85.00);
    expect(txn.postings[0].amount?.currency).toBe('USD');
    
    expect(txn.postings[1].account).toBe('Expenses:Food');
    expect(txn.postings[1].amount?.number).toBe(85.00);
    expect(txn.postings[1].amount?.currency).toBe('USD');
  });

  test("parses account opening and closing", () => {
    const input = `
2022-01-01 open Assets:Checking USD,EUR
2022-12-31 close Assets:Checking
`;
    
    const result = BeancountParser.parse(input);
    
    expect(result.directives.length).toBe(2);
    expect(result.directives[0]).toBeInstanceOf(Open);
    expect(result.directives[1]).toBeInstanceOf(Close);
    
    const open = result.directives[0] as Open;
    expect(open.date.getFullYear()).toBe(2022);
    expect(open.date.getMonth()).toBe(0);
    expect(open.date.getDate()).toBe(1);
    expect(open.account).toBe('Assets:Checking');
    expect(open.currencies).toEqual(['USD', 'EUR']);
    
    const close = result.directives[1] as Close;
    expect(close.date.getFullYear()).toBe(2022);
    expect(close.date.getMonth()).toBe(11); // December is 11
    expect(close.date.getDate()).toBe(31);
    expect(close.account).toBe('Assets:Checking');
  });

  test("parses balance assertions", () => {
    const input = `
2022-01-31 balance Assets:Checking 1500.50 USD
`;
    
    const result = BeancountParser.parse(input);
    
    expect(result.directives.length).toBe(1);
    expect(result.directives[0]).toBeInstanceOf(Balance);
    
    const balance = result.directives[0] as Balance;
    expect(balance.date.getFullYear()).toBe(2022);
    expect(balance.date.getMonth()).toBe(0);
    expect(balance.date.getDate()).toBe(31);
    expect(balance.account).toBe('Assets:Checking');
    expect(balance.amount.number).toBe(1500.50);
    expect(balance.amount.currency).toBe('USD');
  });

  test("parses price directives", () => {
    const input = `
2022-01-15 price EUR 1.08 USD
`;
    
    const result = BeancountParser.parse(input);
    
    expect(result.directives.length).toBe(1);
    expect(result.directives[0]).toBeInstanceOf(Price);
    
    const price = result.directives[0] as Price;
    expect(price.date.getFullYear()).toBe(2022);
    expect(price.date.getMonth()).toBe(0);
    expect(price.date.getDate()).toBe(15);
    expect(price.currency).toBe('EUR');
    expect(price.amount.number).toBe(1.08);
    expect(price.amount.currency).toBe('USD');
  });

  test("parses notes", () => {
    const input = `
2022-01-15 note Assets:Checking "Need to order new checks"
`;
    
    const result = BeancountParser.parse(input);
    
    expect(result.directives.length).toBe(1);
    expect(result.directives[0]).toBeInstanceOf(Note);
    
    const note = result.directives[0] as Note;
    expect(note.date.getFullYear()).toBe(2022);
    expect(note.date.getMonth()).toBe(0);
    expect(note.date.getDate()).toBe(15);
    expect(note.account).toBe('Assets:Checking');
    expect(note.comment).toBe('Need to order new checks');
  });

  test("parses commodity directives", () => {
    const input = `
2022-01-01 commodity USD
`;
    
    const result = BeancountParser.parse(input);
    
    expect(result.directives.length).toBe(1);
    expect(result.directives[0]).toBeInstanceOf(Commodity);
    
    const commodity = result.directives[0] as Commodity;
    expect(commodity.date.getFullYear()).toBe(2022);
    expect(commodity.date.getMonth()).toBe(0);
    expect(commodity.date.getDate()).toBe(1);
    expect(commodity.currency).toBe('USD');
  });

  test("parses complex transaction with cost and price annotations", () => {
    const input = `
2022-03-15 * "Broker" "Buy shares"
  Assets:Investments:Brokerage  10 AAPL {250.00 USD}
  Assets:Checking              -2500.00 USD
`;
    
    const result = BeancountParser.parse(input);
    
    expect(result.directives.length).toBe(1);
    expect(result.directives[0]).toBeInstanceOf(Transaction);
    
    const txn = result.directives[0] as Transaction;
    expect(txn.postings.length).toBe(2);
    
    const posting1 = txn.postings[0];
    expect(posting1.account).toBe('Assets:Investments:Brokerage');
    expect(posting1.amount?.number).toBe(10);
    expect(posting1.amount?.currency).toBe('AAPL');
    expect(posting1.cost?.amount?.number).toBe(250.00);
    expect(posting1.cost?.amount?.currency).toBe('USD');
    
    const posting2 = txn.postings[1];
    expect(posting2.account).toBe('Assets:Checking');
    expect(posting2.amount?.number).toBe(-2500.00);
    expect(posting2.amount?.currency).toBe('USD');
  });

  test("parses a complete Beancount file with multiple directive types", () => {
    const input = `
;; This is a comment
2022-01-01 open Assets:Checking USD
2022-01-01 open Expenses:Food USD
2022-01-01 open Income:Salary USD
2022-01-01 commodity USD

2022-01-15 * "Employer" "Salary"
  Assets:Checking   3000.00 USD
  Income:Salary    -3000.00 USD

2022-01-20 * "Grocery store" "Weekly groceries"
  Assets:Checking  -85.00 USD
  Expenses:Food     85.00 USD

2022-01-31 balance Assets:Checking 2915.00 USD
`;
    
    const result = BeancountParser.parse(input);
    
    expect(result.directives.length).toBe(7);
    expect(result.directives[0]).toBeInstanceOf(Open);
    expect(result.directives[1]).toBeInstanceOf(Open);
    expect(result.directives[2]).toBeInstanceOf(Open);
    expect(result.directives[3]).toBeInstanceOf(Commodity);
    expect(result.directives[4]).toBeInstanceOf(Transaction);
    expect(result.directives[5]).toBeInstanceOf(Transaction);
    expect(result.directives[6]).toBeInstanceOf(Balance);
    
    // Check the last transaction
    const groceryTxn = result.directives[5] as Transaction;
    expect(groceryTxn.payee).toBe('Grocery store');
    expect(groceryTxn.narration).toBe('Weekly groceries');
    expect(groceryTxn.postings.length).toBe(2);
    
    // Check the balance assertion
    const balance = result.directives[6] as Balance;
    expect(balance.account).toBe('Assets:Checking');
    expect(balance.amount.number).toBe(2915.00);
    expect(balance.amount.currency).toBe('USD');
  });
});