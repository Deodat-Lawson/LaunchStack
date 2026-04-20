/**
 * Type declarations for pdf-lib
 */
declare module "pdf-lib" {
  export interface PDFPage {
    getWidth(): number;
    getHeight(): number;
    node: {
      Resources(): PDFDict | undefined;
    };
  }

  export interface PDFDict {
    lookup(key: string[]): unknown;
    get(key: string): unknown;
  }

  export interface PDFFont {
    name: string;
  }

  export interface PDFForm {
    getFields(): PDFField[];
    getTextField(name: string): PDFTextField | undefined;
    getCheckBox(name: string): PDFCheckBox | undefined;
    getDropdown(name: string): PDFDropdown | undefined;
    getRadioGroup(name: string): PDFRadioGroup | undefined;
  }

  export interface PDFField {
    getName(): string;
    isReadOnly(): boolean;
  }

  export interface PDFTextField extends PDFField {
    getText(): string | undefined;
    setText(text: string): void;
  }

  export interface PDFCheckBox extends PDFField {
    isChecked(): boolean;
    check(): void;
    uncheck(): void;
  }

  export interface PDFDropdown extends PDFField {
    getOptions(): string[];
    getSelected(): string[];
    select(option: string): void;
  }

  export interface PDFRadioGroup extends PDFField {
    getOptions(): string[];
    getSelected(): string | undefined;
    select(option: string): void;
  }

  export interface LoadOptions {
    ignoreEncryption?: boolean;
    parseSpeed?: number;
    throwOnInvalidObject?: boolean;
    updateMetadata?: boolean;
    capNumbers?: boolean;
  }

  export class PDFDocument {
    static load(
      pdf: string | Uint8Array | ArrayBuffer,
      options?: LoadOptions
    ): Promise<PDFDocument>;

    static create(): Promise<PDFDocument>;

    getPageCount(): number;
    getPage(index: number): PDFPage;
    getPages(): PDFPage[];

    getTitle(): string | undefined;
    getAuthor(): string | undefined;
    getSubject(): string | undefined;
    getKeywords(): string | undefined;
    getCreator(): string | undefined;
    getProducer(): string | undefined;
    getCreationDate(): Date | undefined;
    getModificationDate(): Date | undefined;

    setTitle(title: string): void;
    setAuthor(author: string): void;
    setSubject(subject: string): void;
    setKeywords(keywords: string[]): void;
    setCreator(creator: string): void;
    setProducer(producer: string): void;

    getForm(): PDFForm;

    addPage(page?: PDFPage | [number, number]): PDFPage;
    insertPage(index: number, page?: PDFPage | [number, number]): PDFPage;
    removePage(index: number): void;

    save(): Promise<Uint8Array>;
    saveAsBase64(): Promise<string>;

    embedFont(font: StandardFonts | Uint8Array | ArrayBuffer): Promise<PDFFont>;
    embedPng(image: Uint8Array | ArrayBuffer | string): Promise<PDFImage>;
    embedJpg(image: Uint8Array | ArrayBuffer | string): Promise<PDFImage>;

    getEmbedderFonts?(): PDFFont[];
  }

  export interface PDFImage {
    width: number;
    height: number;
    scale(factor: number): { width: number; height: number };
  }

  export enum StandardFonts {
    Courier = "Courier",
    CourierBold = "Courier-Bold",
    CourierBoldOblique = "Courier-BoldOblique",
    CourierOblique = "Courier-Oblique",
    Helvetica = "Helvetica",
    HelveticaBold = "Helvetica-Bold",
    HelveticaBoldOblique = "Helvetica-BoldOblique",
    HelveticaOblique = "Helvetica-Oblique",
    TimesRoman = "Times-Roman",
    TimesRomanBold = "Times-Bold",
    TimesRomanBoldItalic = "Times-BoldItalic",
    TimesRomanItalic = "Times-Italic",
    Symbol = "Symbol",
    ZapfDingbats = "ZapfDingbats",
  }
}

