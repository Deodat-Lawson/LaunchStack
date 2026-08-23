var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/config.ts
function nonnegativeInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === void 0 || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a nonnegative integer`);
  }
  return value;
}
function loadCallWorkerConfig() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const configuredWorkerId = process.env.CALL_WORKER_ID?.trim();
  return {
    databaseUrl,
    workerId: configuredWorkerId && configuredWorkerId.length > 0 ? configuredWorkerId : `call-worker-${process.pid}`,
    captureEnabled: process.env.CALL_NOTES_CAPTURE_ENABLED === "true",
    maxConcurrentStreams: nonnegativeInteger("ZOOM_RTMS_MAX_CONCURRENT_STREAMS", 0),
    pollIntervalMs: nonnegativeInteger("CALL_WORKER_POLL_INTERVAL_MS", 1e3)
  };
}

// src/worker.ts
import { setTimeout as delay } from "node:timers/promises";

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/entity.js
var entityKind = Symbol.for("drizzle:entityKind");
var hasOwnEntityKind = Symbol.for("drizzle:hasOwnEntityKind");
function is(value, type) {
  if (!value || typeof value !== "object") {
    return false;
  }
  if (value instanceof type) {
    return true;
  }
  if (!Object.prototype.hasOwnProperty.call(type, entityKind)) {
    throw new Error(
      `Class "${type.name ?? "<unknown>"}" doesn't look like a Drizzle entity. If this is incorrect and the class is provided by Drizzle, please report this as a bug.`
    );
  }
  let cls = Object.getPrototypeOf(value).constructor;
  if (cls) {
    while (cls) {
      if (entityKind in cls && cls[entityKind] === type[entityKind]) {
        return true;
      }
      cls = Object.getPrototypeOf(cls);
    }
  }
  return false;
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/column.js
var Column = class {
  constructor(table, config) {
    this.table = table;
    this.config = config;
    this.name = config.name;
    this.keyAsName = config.keyAsName;
    this.notNull = config.notNull;
    this.default = config.default;
    this.defaultFn = config.defaultFn;
    this.onUpdateFn = config.onUpdateFn;
    this.hasDefault = config.hasDefault;
    this.primary = config.primaryKey;
    this.isUnique = config.isUnique;
    this.uniqueName = config.uniqueName;
    this.uniqueType = config.uniqueType;
    this.dataType = config.dataType;
    this.columnType = config.columnType;
    this.generated = config.generated;
    this.generatedIdentity = config.generatedIdentity;
  }
  static [entityKind] = "Column";
  name;
  keyAsName;
  primary;
  notNull;
  default;
  defaultFn;
  onUpdateFn;
  hasDefault;
  isUnique;
  uniqueName;
  uniqueType;
  dataType;
  columnType;
  enumValues = void 0;
  generated = void 0;
  generatedIdentity = void 0;
  config;
  mapFromDriverValue(value) {
    return value;
  }
  mapToDriverValue(value) {
    return value;
  }
  // ** @internal */
  shouldDisableInsert() {
    return this.config.generated !== void 0 && this.config.generated.type !== "byDefault";
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/column-builder.js
var ColumnBuilder = class {
  static [entityKind] = "ColumnBuilder";
  config;
  constructor(name, dataType, columnType) {
    this.config = {
      name,
      keyAsName: name === "",
      notNull: false,
      default: void 0,
      hasDefault: false,
      primaryKey: false,
      isUnique: false,
      uniqueName: void 0,
      uniqueType: void 0,
      dataType,
      columnType,
      generated: void 0
    };
  }
  /**
   * Changes the data type of the column. Commonly used with `json` columns. Also, useful for branded types.
   *
   * @example
   * ```ts
   * const users = pgTable('users', {
   * 	id: integer('id').$type<UserId>().primaryKey(),
   * 	details: json('details').$type<UserDetails>().notNull(),
   * });
   * ```
   */
  $type() {
    return this;
  }
  /**
   * Adds a `not null` clause to the column definition.
   *
   * Affects the `select` model of the table - columns *without* `not null` will be nullable on select.
   */
  notNull() {
    this.config.notNull = true;
    return this;
  }
  /**
   * Adds a `default <value>` clause to the column definition.
   *
   * Affects the `insert` model of the table - columns *with* `default` are optional on insert.
   *
   * If you need to set a dynamic default value, use {@link $defaultFn} instead.
   */
  default(value) {
    this.config.default = value;
    this.config.hasDefault = true;
    return this;
  }
  /**
   * Adds a dynamic default value to the column.
   * The function will be called when the row is inserted, and the returned value will be used as the column value.
   *
   * **Note:** This value does not affect the `drizzle-kit` behavior, it is only used at runtime in `drizzle-orm`.
   */
  $defaultFn(fn) {
    this.config.defaultFn = fn;
    this.config.hasDefault = true;
    return this;
  }
  /**
   * Alias for {@link $defaultFn}.
   */
  $default = this.$defaultFn;
  /**
   * Adds a dynamic update value to the column.
   * The function will be called when the row is updated, and the returned value will be used as the column value if none is provided.
   * If no `default` (or `$defaultFn`) value is provided, the function will be called when the row is inserted as well, and the returned value will be used as the column value.
   *
   * **Note:** This value does not affect the `drizzle-kit` behavior, it is only used at runtime in `drizzle-orm`.
   */
  $onUpdateFn(fn) {
    this.config.onUpdateFn = fn;
    this.config.hasDefault = true;
    return this;
  }
  /**
   * Alias for {@link $onUpdateFn}.
   */
  $onUpdate = this.$onUpdateFn;
  /**
   * Adds a `primary key` clause to the column definition. This implicitly makes the column `not null`.
   *
   * In SQLite, `integer primary key` implicitly makes the column auto-incrementing.
   */
  primaryKey() {
    this.config.primaryKey = true;
    this.config.notNull = true;
    return this;
  }
  /** @internal Sets the name of the column to the key within the table definition if a name was not given. */
  setName(name) {
    if (this.config.name !== "") return;
    this.config.name = name;
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/table.utils.js
var TableName = Symbol.for("drizzle:Name");

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/foreign-keys.js
var ForeignKeyBuilder = class {
  static [entityKind] = "PgForeignKeyBuilder";
  /** @internal */
  reference;
  /** @internal */
  _onUpdate = "no action";
  /** @internal */
  _onDelete = "no action";
  constructor(config, actions) {
    this.reference = () => {
      const { name, columns, foreignColumns } = config();
      return { name, columns, foreignTable: foreignColumns[0].table, foreignColumns };
    };
    if (actions) {
      this._onUpdate = actions.onUpdate;
      this._onDelete = actions.onDelete;
    }
  }
  onUpdate(action) {
    this._onUpdate = action === void 0 ? "no action" : action;
    return this;
  }
  onDelete(action) {
    this._onDelete = action === void 0 ? "no action" : action;
    return this;
  }
  /** @internal */
  build(table) {
    return new ForeignKey(table, this);
  }
};
var ForeignKey = class {
  constructor(table, builder) {
    this.table = table;
    this.reference = builder.reference;
    this.onUpdate = builder._onUpdate;
    this.onDelete = builder._onDelete;
  }
  static [entityKind] = "PgForeignKey";
  reference;
  onUpdate;
  onDelete;
  getName() {
    const { name, columns, foreignColumns } = this.reference();
    const columnNames = columns.map((column) => column.name);
    const foreignColumnNames = foreignColumns.map((column) => column.name);
    const chunks = [
      this.table[TableName],
      ...columnNames,
      foreignColumns[0].table[TableName],
      ...foreignColumnNames
    ];
    return name ?? `${chunks.join("_")}_fk`;
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/tracing-utils.js
function iife(fn, ...args) {
  return fn(...args);
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/unique-constraint.js
function uniqueKeyName(table, columns) {
  return `${table[TableName]}_${columns.join("_")}_unique`;
}
var UniqueConstraintBuilder = class {
  constructor(columns, name) {
    this.name = name;
    this.columns = columns;
  }
  static [entityKind] = "PgUniqueConstraintBuilder";
  /** @internal */
  columns;
  /** @internal */
  nullsNotDistinctConfig = false;
  nullsNotDistinct() {
    this.nullsNotDistinctConfig = true;
    return this;
  }
  /** @internal */
  build(table) {
    return new UniqueConstraint(table, this.columns, this.nullsNotDistinctConfig, this.name);
  }
};
var UniqueOnConstraintBuilder = class {
  static [entityKind] = "PgUniqueOnConstraintBuilder";
  /** @internal */
  name;
  constructor(name) {
    this.name = name;
  }
  on(...columns) {
    return new UniqueConstraintBuilder(columns, this.name);
  }
};
var UniqueConstraint = class {
  constructor(table, columns, nullsNotDistinct, name) {
    this.table = table;
    this.columns = columns;
    this.name = name ?? uniqueKeyName(this.table, this.columns.map((column) => column.name));
    this.nullsNotDistinct = nullsNotDistinct;
  }
  static [entityKind] = "PgUniqueConstraint";
  columns;
  name;
  nullsNotDistinct = false;
  getName() {
    return this.name;
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/utils/array.js
function parsePgArrayValue(arrayString, startFrom, inQuotes) {
  for (let i = startFrom; i < arrayString.length; i++) {
    const char2 = arrayString[i];
    if (char2 === "\\") {
      i++;
      continue;
    }
    if (char2 === '"') {
      return [arrayString.slice(startFrom, i).replace(/\\/g, ""), i + 1];
    }
    if (inQuotes) {
      continue;
    }
    if (char2 === "," || char2 === "}") {
      return [arrayString.slice(startFrom, i).replace(/\\/g, ""), i];
    }
  }
  return [arrayString.slice(startFrom).replace(/\\/g, ""), arrayString.length];
}
function parsePgNestedArray(arrayString, startFrom = 0) {
  const result = [];
  let i = startFrom;
  let lastCharIsComma = false;
  while (i < arrayString.length) {
    const char2 = arrayString[i];
    if (char2 === ",") {
      if (lastCharIsComma || i === startFrom) {
        result.push("");
      }
      lastCharIsComma = true;
      i++;
      continue;
    }
    lastCharIsComma = false;
    if (char2 === "\\") {
      i += 2;
      continue;
    }
    if (char2 === '"') {
      const [value2, startFrom2] = parsePgArrayValue(arrayString, i + 1, true);
      result.push(value2);
      i = startFrom2;
      continue;
    }
    if (char2 === "}") {
      return [result, i + 1];
    }
    if (char2 === "{") {
      const [value2, startFrom2] = parsePgNestedArray(arrayString, i + 1);
      result.push(value2);
      i = startFrom2;
      continue;
    }
    const [value, newStartFrom] = parsePgArrayValue(arrayString, i, false);
    result.push(value);
    i = newStartFrom;
  }
  return [result, i];
}
function parsePgArray(arrayString) {
  const [result] = parsePgNestedArray(arrayString, 1);
  return result;
}
function makePgArray(array) {
  return `{${array.map((item) => {
    if (Array.isArray(item)) {
      return makePgArray(item);
    }
    if (typeof item === "string") {
      return `"${item.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }
    return `${item}`;
  }).join(",")}}`;
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/common.js
var PgColumnBuilder = class extends ColumnBuilder {
  foreignKeyConfigs = [];
  static [entityKind] = "PgColumnBuilder";
  array(size2) {
    return new PgArrayBuilder(this.config.name, this, size2);
  }
  references(ref, actions = {}) {
    this.foreignKeyConfigs.push({ ref, actions });
    return this;
  }
  unique(name, config) {
    this.config.isUnique = true;
    this.config.uniqueName = name;
    this.config.uniqueType = config?.nulls;
    return this;
  }
  generatedAlwaysAs(as) {
    this.config.generated = {
      as,
      type: "always",
      mode: "stored"
    };
    return this;
  }
  /** @internal */
  buildForeignKeys(column, table) {
    return this.foreignKeyConfigs.map(({ ref, actions }) => {
      return iife(
        (ref2, actions2) => {
          const builder = new ForeignKeyBuilder(() => {
            const foreignColumn = ref2();
            return { columns: [column], foreignColumns: [foreignColumn] };
          });
          if (actions2.onUpdate) {
            builder.onUpdate(actions2.onUpdate);
          }
          if (actions2.onDelete) {
            builder.onDelete(actions2.onDelete);
          }
          return builder.build(table);
        },
        ref,
        actions
      );
    });
  }
  /** @internal */
  buildExtraConfigColumn(table) {
    return new ExtraConfigColumn(table, this.config);
  }
};
var PgColumn = class extends Column {
  constructor(table, config) {
    if (!config.uniqueName) {
      config.uniqueName = uniqueKeyName(table, [config.name]);
    }
    super(table, config);
    this.table = table;
  }
  static [entityKind] = "PgColumn";
};
var ExtraConfigColumn = class extends PgColumn {
  static [entityKind] = "ExtraConfigColumn";
  getSQLType() {
    return this.getSQLType();
  }
  indexConfig = {
    order: this.config.order ?? "asc",
    nulls: this.config.nulls ?? "last",
    opClass: this.config.opClass
  };
  defaultConfig = {
    order: "asc",
    nulls: "last",
    opClass: void 0
  };
  asc() {
    this.indexConfig.order = "asc";
    return this;
  }
  desc() {
    this.indexConfig.order = "desc";
    return this;
  }
  nullsFirst() {
    this.indexConfig.nulls = "first";
    return this;
  }
  nullsLast() {
    this.indexConfig.nulls = "last";
    return this;
  }
  /**
   * ### PostgreSQL documentation quote
   *
   * > An operator class with optional parameters can be specified for each column of an index.
   * The operator class identifies the operators to be used by the index for that column.
   * For example, a B-tree index on four-byte integers would use the int4_ops class;
   * this operator class includes comparison functions for four-byte integers.
   * In practice the default operator class for the column's data type is usually sufficient.
   * The main point of having operator classes is that for some data types, there could be more than one meaningful ordering.
   * For example, we might want to sort a complex-number data type either by absolute value or by real part.
   * We could do this by defining two operator classes for the data type and then selecting the proper class when creating an index.
   * More information about operator classes check:
   *
   * ### Useful links
   * https://www.postgresql.org/docs/current/sql-createindex.html
   *
   * https://www.postgresql.org/docs/current/indexes-opclass.html
   *
   * https://www.postgresql.org/docs/current/xindex.html
   *
   * ### Additional types
   * If you have the `pg_vector` extension installed in your database, you can use the
   * `vector_l2_ops`, `vector_ip_ops`, `vector_cosine_ops`, `vector_l1_ops`, `bit_hamming_ops`, `bit_jaccard_ops`, `halfvec_l2_ops`, `sparsevec_l2_ops` options, which are predefined types.
   *
   * **You can always specify any string you want in the operator class, in case Drizzle doesn't have it natively in its types**
   *
   * @param opClass
   * @returns
   */
  op(opClass) {
    this.indexConfig.opClass = opClass;
    return this;
  }
};
var IndexedColumn = class {
  static [entityKind] = "IndexedColumn";
  constructor(name, keyAsName, type, indexConfig) {
    this.name = name;
    this.keyAsName = keyAsName;
    this.type = type;
    this.indexConfig = indexConfig;
  }
  name;
  keyAsName;
  type;
  indexConfig;
};
var PgArrayBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgArrayBuilder";
  constructor(name, baseBuilder, size2) {
    super(name, "array", "PgArray");
    this.config.baseBuilder = baseBuilder;
    this.config.size = size2;
  }
  /** @internal */
  build(table) {
    const baseColumn = this.config.baseBuilder.build(table);
    return new PgArray(
      table,
      this.config,
      baseColumn
    );
  }
};
var PgArray = class _PgArray extends PgColumn {
  constructor(table, config, baseColumn, range) {
    super(table, config);
    this.baseColumn = baseColumn;
    this.range = range;
    this.size = config.size;
  }
  size;
  static [entityKind] = "PgArray";
  getSQLType() {
    return `${this.baseColumn.getSQLType()}[${typeof this.size === "number" ? this.size : ""}]`;
  }
  mapFromDriverValue(value) {
    if (typeof value === "string") {
      value = parsePgArray(value);
    }
    return value.map((v) => this.baseColumn.mapFromDriverValue(v));
  }
  mapToDriverValue(value, isNestedArray = false) {
    const a = value.map(
      (v) => v === null ? null : is(this.baseColumn, _PgArray) ? this.baseColumn.mapToDriverValue(v, true) : this.baseColumn.mapToDriverValue(v)
    );
    if (isNestedArray) return a;
    return makePgArray(a);
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/enum.js
var PgEnumObjectColumnBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgEnumObjectColumnBuilder";
  constructor(name, enumInstance) {
    super(name, "string", "PgEnumObjectColumn");
    this.config.enum = enumInstance;
  }
  /** @internal */
  build(table) {
    return new PgEnumObjectColumn(
      table,
      this.config
    );
  }
};
var PgEnumObjectColumn = class extends PgColumn {
  static [entityKind] = "PgEnumObjectColumn";
  enum;
  enumValues = this.config.enum.enumValues;
  constructor(table, config) {
    super(table, config);
    this.enum = config.enum;
  }
  getSQLType() {
    return this.enum.enumName;
  }
};
var isPgEnumSym = Symbol.for("drizzle:isPgEnum");
function isPgEnum(obj) {
  return !!obj && typeof obj === "function" && isPgEnumSym in obj && obj[isPgEnumSym] === true;
}
var PgEnumColumnBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgEnumColumnBuilder";
  constructor(name, enumInstance) {
    super(name, "string", "PgEnumColumn");
    this.config.enum = enumInstance;
  }
  /** @internal */
  build(table) {
    return new PgEnumColumn(
      table,
      this.config
    );
  }
};
var PgEnumColumn = class extends PgColumn {
  static [entityKind] = "PgEnumColumn";
  enum = this.config.enum;
  enumValues = this.config.enum.enumValues;
  constructor(table, config) {
    super(table, config);
    this.enum = config.enum;
  }
  getSQLType() {
    return this.enum.enumName;
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/subquery.js
var Subquery = class {
  static [entityKind] = "Subquery";
  constructor(sql2, fields, alias, isWith = false, usedTables = []) {
    this._ = {
      brand: "Subquery",
      sql: sql2,
      selectedFields: fields,
      alias,
      isWith,
      usedTables
    };
  }
  // getSQL(): SQL<unknown> {
  // 	return new SQL([this]);
  // }
};
var WithSubquery = class extends Subquery {
  static [entityKind] = "WithSubquery";
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/version.js
var version = "0.45.1";

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/tracing.js
var otel;
var rawTracer;
var tracer = {
  startActiveSpan(name, fn) {
    if (!otel) {
      return fn();
    }
    if (!rawTracer) {
      rawTracer = otel.trace.getTracer("drizzle-orm", version);
    }
    return iife(
      (otel2, rawTracer2) => rawTracer2.startActiveSpan(
        name,
        (span) => {
          try {
            return fn(span);
          } catch (e) {
            span.setStatus({
              code: otel2.SpanStatusCode.ERROR,
              message: e instanceof Error ? e.message : "Unknown error"
              // eslint-disable-line no-instanceof/no-instanceof
            });
            throw e;
          } finally {
            span.end();
          }
        }
      ),
      otel,
      rawTracer
    );
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/view-common.js
var ViewBaseConfig = Symbol.for("drizzle:ViewBaseConfig");

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/table.js
var Schema = Symbol.for("drizzle:Schema");
var Columns = Symbol.for("drizzle:Columns");
var ExtraConfigColumns = Symbol.for("drizzle:ExtraConfigColumns");
var OriginalName = Symbol.for("drizzle:OriginalName");
var BaseName = Symbol.for("drizzle:BaseName");
var IsAlias = Symbol.for("drizzle:IsAlias");
var ExtraConfigBuilder = Symbol.for("drizzle:ExtraConfigBuilder");
var IsDrizzleTable = Symbol.for("drizzle:IsDrizzleTable");
var Table = class {
  static [entityKind] = "Table";
  /** @internal */
  static Symbol = {
    Name: TableName,
    Schema,
    OriginalName,
    Columns,
    ExtraConfigColumns,
    BaseName,
    IsAlias,
    ExtraConfigBuilder
  };
  /**
   * @internal
   * Can be changed if the table is aliased.
   */
  [TableName];
  /**
   * @internal
   * Used to store the original name of the table, before any aliasing.
   */
  [OriginalName];
  /** @internal */
  [Schema];
  /** @internal */
  [Columns];
  /** @internal */
  [ExtraConfigColumns];
  /**
   *  @internal
   * Used to store the table name before the transformation via the `tableCreator` functions.
   */
  [BaseName];
  /** @internal */
  [IsAlias] = false;
  /** @internal */
  [IsDrizzleTable] = true;
  /** @internal */
  [ExtraConfigBuilder] = void 0;
  constructor(name, schema, baseName) {
    this[TableName] = this[OriginalName] = name;
    this[Schema] = schema;
    this[BaseName] = baseName;
  }
};
function getTableName(table) {
  return table[TableName];
}
function getTableUniqueName(table) {
  return `${table[Schema] ?? "public"}.${table[TableName]}`;
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/sql/sql.js
var FakePrimitiveParam = class {
  static [entityKind] = "FakePrimitiveParam";
};
function isSQLWrapper(value) {
  return value !== null && value !== void 0 && typeof value.getSQL === "function";
}
function mergeQueries(queries) {
  const result = { sql: "", params: [] };
  for (const query of queries) {
    result.sql += query.sql;
    result.params.push(...query.params);
    if (query.typings?.length) {
      if (!result.typings) {
        result.typings = [];
      }
      result.typings.push(...query.typings);
    }
  }
  return result;
}
var StringChunk = class {
  static [entityKind] = "StringChunk";
  value;
  constructor(value) {
    this.value = Array.isArray(value) ? value : [value];
  }
  getSQL() {
    return new SQL([this]);
  }
};
var SQL = class _SQL {
  constructor(queryChunks) {
    this.queryChunks = queryChunks;
    for (const chunk of queryChunks) {
      if (is(chunk, Table)) {
        const schemaName = chunk[Table.Symbol.Schema];
        this.usedTables.push(
          schemaName === void 0 ? chunk[Table.Symbol.Name] : schemaName + "." + chunk[Table.Symbol.Name]
        );
      }
    }
  }
  static [entityKind] = "SQL";
  /** @internal */
  decoder = noopDecoder;
  shouldInlineParams = false;
  /** @internal */
  usedTables = [];
  append(query) {
    this.queryChunks.push(...query.queryChunks);
    return this;
  }
  toQuery(config) {
    return tracer.startActiveSpan("drizzle.buildSQL", (span) => {
      const query = this.buildQueryFromSourceParams(this.queryChunks, config);
      span?.setAttributes({
        "drizzle.query.text": query.sql,
        "drizzle.query.params": JSON.stringify(query.params)
      });
      return query;
    });
  }
  buildQueryFromSourceParams(chunks, _config) {
    const config = Object.assign({}, _config, {
      inlineParams: _config.inlineParams || this.shouldInlineParams,
      paramStartIndex: _config.paramStartIndex || { value: 0 }
    });
    const {
      casing,
      escapeName,
      escapeParam,
      prepareTyping,
      inlineParams,
      paramStartIndex
    } = config;
    return mergeQueries(chunks.map((chunk) => {
      if (is(chunk, StringChunk)) {
        return { sql: chunk.value.join(""), params: [] };
      }
      if (is(chunk, Name)) {
        return { sql: escapeName(chunk.value), params: [] };
      }
      if (chunk === void 0) {
        return { sql: "", params: [] };
      }
      if (Array.isArray(chunk)) {
        const result = [new StringChunk("(")];
        for (const [i, p] of chunk.entries()) {
          result.push(p);
          if (i < chunk.length - 1) {
            result.push(new StringChunk(", "));
          }
        }
        result.push(new StringChunk(")"));
        return this.buildQueryFromSourceParams(result, config);
      }
      if (is(chunk, _SQL)) {
        return this.buildQueryFromSourceParams(chunk.queryChunks, {
          ...config,
          inlineParams: inlineParams || chunk.shouldInlineParams
        });
      }
      if (is(chunk, Table)) {
        const schemaName = chunk[Table.Symbol.Schema];
        const tableName = chunk[Table.Symbol.Name];
        return {
          sql: schemaName === void 0 || chunk[IsAlias] ? escapeName(tableName) : escapeName(schemaName) + "." + escapeName(tableName),
          params: []
        };
      }
      if (is(chunk, Column)) {
        const columnName = casing.getColumnCasing(chunk);
        if (_config.invokeSource === "indexes") {
          return { sql: escapeName(columnName), params: [] };
        }
        const schemaName = chunk.table[Table.Symbol.Schema];
        return {
          sql: chunk.table[IsAlias] || schemaName === void 0 ? escapeName(chunk.table[Table.Symbol.Name]) + "." + escapeName(columnName) : escapeName(schemaName) + "." + escapeName(chunk.table[Table.Symbol.Name]) + "." + escapeName(columnName),
          params: []
        };
      }
      if (is(chunk, View)) {
        const schemaName = chunk[ViewBaseConfig].schema;
        const viewName = chunk[ViewBaseConfig].name;
        return {
          sql: schemaName === void 0 || chunk[ViewBaseConfig].isAlias ? escapeName(viewName) : escapeName(schemaName) + "." + escapeName(viewName),
          params: []
        };
      }
      if (is(chunk, Param)) {
        if (is(chunk.value, Placeholder)) {
          return { sql: escapeParam(paramStartIndex.value++, chunk), params: [chunk], typings: ["none"] };
        }
        const mappedValue = chunk.value === null ? null : chunk.encoder.mapToDriverValue(chunk.value);
        if (is(mappedValue, _SQL)) {
          return this.buildQueryFromSourceParams([mappedValue], config);
        }
        if (inlineParams) {
          return { sql: this.mapInlineParam(mappedValue, config), params: [] };
        }
        let typings = ["none"];
        if (prepareTyping) {
          typings = [prepareTyping(chunk.encoder)];
        }
        return { sql: escapeParam(paramStartIndex.value++, mappedValue), params: [mappedValue], typings };
      }
      if (is(chunk, Placeholder)) {
        return { sql: escapeParam(paramStartIndex.value++, chunk), params: [chunk], typings: ["none"] };
      }
      if (is(chunk, _SQL.Aliased) && chunk.fieldAlias !== void 0) {
        return { sql: escapeName(chunk.fieldAlias), params: [] };
      }
      if (is(chunk, Subquery)) {
        if (chunk._.isWith) {
          return { sql: escapeName(chunk._.alias), params: [] };
        }
        return this.buildQueryFromSourceParams([
          new StringChunk("("),
          chunk._.sql,
          new StringChunk(") "),
          new Name(chunk._.alias)
        ], config);
      }
      if (isPgEnum(chunk)) {
        if (chunk.schema) {
          return { sql: escapeName(chunk.schema) + "." + escapeName(chunk.enumName), params: [] };
        }
        return { sql: escapeName(chunk.enumName), params: [] };
      }
      if (isSQLWrapper(chunk)) {
        if (chunk.shouldOmitSQLParens?.()) {
          return this.buildQueryFromSourceParams([chunk.getSQL()], config);
        }
        return this.buildQueryFromSourceParams([
          new StringChunk("("),
          chunk.getSQL(),
          new StringChunk(")")
        ], config);
      }
      if (inlineParams) {
        return { sql: this.mapInlineParam(chunk, config), params: [] };
      }
      return { sql: escapeParam(paramStartIndex.value++, chunk), params: [chunk], typings: ["none"] };
    }));
  }
  mapInlineParam(chunk, { escapeString }) {
    if (chunk === null) {
      return "null";
    }
    if (typeof chunk === "number" || typeof chunk === "boolean") {
      return chunk.toString();
    }
    if (typeof chunk === "string") {
      return escapeString(chunk);
    }
    if (typeof chunk === "object") {
      const mappedValueAsString = chunk.toString();
      if (mappedValueAsString === "[object Object]") {
        return escapeString(JSON.stringify(chunk));
      }
      return escapeString(mappedValueAsString);
    }
    throw new Error("Unexpected param value: " + chunk);
  }
  getSQL() {
    return this;
  }
  as(alias) {
    if (alias === void 0) {
      return this;
    }
    return new _SQL.Aliased(this, alias);
  }
  mapWith(decoder) {
    this.decoder = typeof decoder === "function" ? { mapFromDriverValue: decoder } : decoder;
    return this;
  }
  inlineParams() {
    this.shouldInlineParams = true;
    return this;
  }
  /**
   * This method is used to conditionally include a part of the query.
   *
   * @param condition - Condition to check
   * @returns itself if the condition is `true`, otherwise `undefined`
   */
  if(condition) {
    return condition ? this : void 0;
  }
};
var Name = class {
  constructor(value) {
    this.value = value;
  }
  static [entityKind] = "Name";
  brand;
  getSQL() {
    return new SQL([this]);
  }
};
function isDriverValueEncoder(value) {
  return typeof value === "object" && value !== null && "mapToDriverValue" in value && typeof value.mapToDriverValue === "function";
}
var noopDecoder = {
  mapFromDriverValue: (value) => value
};
var noopEncoder = {
  mapToDriverValue: (value) => value
};
var noopMapper = {
  ...noopDecoder,
  ...noopEncoder
};
var Param = class {
  /**
   * @param value - Parameter value
   * @param encoder - Encoder to convert the value to a driver parameter
   */
  constructor(value, encoder = noopEncoder) {
    this.value = value;
    this.encoder = encoder;
  }
  static [entityKind] = "Param";
  brand;
  getSQL() {
    return new SQL([this]);
  }
};
function sql(strings, ...params) {
  const queryChunks = [];
  if (params.length > 0 || strings.length > 0 && strings[0] !== "") {
    queryChunks.push(new StringChunk(strings[0]));
  }
  for (const [paramIndex, param2] of params.entries()) {
    queryChunks.push(param2, new StringChunk(strings[paramIndex + 1]));
  }
  return new SQL(queryChunks);
}
((sql2) => {
  function empty() {
    return new SQL([]);
  }
  sql2.empty = empty;
  function fromList(list) {
    return new SQL(list);
  }
  sql2.fromList = fromList;
  function raw(str) {
    return new SQL([new StringChunk(str)]);
  }
  sql2.raw = raw;
  function join(chunks, separator) {
    const result = [];
    for (const [i, chunk] of chunks.entries()) {
      if (i > 0 && separator !== void 0) {
        result.push(separator);
      }
      result.push(chunk);
    }
    return new SQL(result);
  }
  sql2.join = join;
  function identifier(value) {
    return new Name(value);
  }
  sql2.identifier = identifier;
  function placeholder2(name2) {
    return new Placeholder(name2);
  }
  sql2.placeholder = placeholder2;
  function param2(value, encoder) {
    return new Param(value, encoder);
  }
  sql2.param = param2;
})(sql || (sql = {}));
((SQL2) => {
  class Aliased {
    constructor(sql2, fieldAlias) {
      this.sql = sql2;
      this.fieldAlias = fieldAlias;
    }
    static [entityKind] = "SQL.Aliased";
    /** @internal */
    isSelectionField = false;
    getSQL() {
      return this.sql;
    }
    /** @internal */
    clone() {
      return new Aliased(this.sql, this.fieldAlias);
    }
  }
  SQL2.Aliased = Aliased;
})(SQL || (SQL = {}));
var Placeholder = class {
  constructor(name2) {
    this.name = name2;
  }
  static [entityKind] = "Placeholder";
  getSQL() {
    return new SQL([this]);
  }
};
function fillPlaceholders(params, values2) {
  return params.map((p) => {
    if (is(p, Placeholder)) {
      if (!(p.name in values2)) {
        throw new Error(`No value for placeholder "${p.name}" was provided`);
      }
      return values2[p.name];
    }
    if (is(p, Param) && is(p.value, Placeholder)) {
      if (!(p.value.name in values2)) {
        throw new Error(`No value for placeholder "${p.value.name}" was provided`);
      }
      return p.encoder.mapToDriverValue(values2[p.value.name]);
    }
    return p;
  });
}
var IsDrizzleView = Symbol.for("drizzle:IsDrizzleView");
var View = class {
  static [entityKind] = "View";
  /** @internal */
  [ViewBaseConfig];
  /** @internal */
  [IsDrizzleView] = true;
  constructor({ name: name2, schema, selectedFields, query }) {
    this[ViewBaseConfig] = {
      name: name2,
      originalName: name2,
      schema,
      selectedFields,
      query,
      isExisting: !query,
      isAlias: false
    };
  }
  getSQL() {
    return new SQL([this]);
  }
};
Column.prototype.getSQL = function() {
  return new SQL([this]);
};
Table.prototype.getSQL = function() {
  return new SQL([this]);
};
Subquery.prototype.getSQL = function() {
  return new SQL([this]);
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/alias.js
var ColumnAliasProxyHandler = class {
  constructor(table) {
    this.table = table;
  }
  static [entityKind] = "ColumnAliasProxyHandler";
  get(columnObj, prop) {
    if (prop === "table") {
      return this.table;
    }
    return columnObj[prop];
  }
};
var TableAliasProxyHandler = class {
  constructor(alias, replaceOriginalName) {
    this.alias = alias;
    this.replaceOriginalName = replaceOriginalName;
  }
  static [entityKind] = "TableAliasProxyHandler";
  get(target, prop) {
    if (prop === Table.Symbol.IsAlias) {
      return true;
    }
    if (prop === Table.Symbol.Name) {
      return this.alias;
    }
    if (this.replaceOriginalName && prop === Table.Symbol.OriginalName) {
      return this.alias;
    }
    if (prop === ViewBaseConfig) {
      return {
        ...target[ViewBaseConfig],
        name: this.alias,
        isAlias: true
      };
    }
    if (prop === Table.Symbol.Columns) {
      const columns = target[Table.Symbol.Columns];
      if (!columns) {
        return columns;
      }
      const proxiedColumns = {};
      Object.keys(columns).map((key) => {
        proxiedColumns[key] = new Proxy(
          columns[key],
          new ColumnAliasProxyHandler(new Proxy(target, this))
        );
      });
      return proxiedColumns;
    }
    const value = target[prop];
    if (is(value, Column)) {
      return new Proxy(value, new ColumnAliasProxyHandler(new Proxy(target, this)));
    }
    return value;
  }
};
var RelationTableAliasProxyHandler = class {
  constructor(alias) {
    this.alias = alias;
  }
  static [entityKind] = "RelationTableAliasProxyHandler";
  get(target, prop) {
    if (prop === "sourceTable") {
      return aliasedTable(target.sourceTable, this.alias);
    }
    return target[prop];
  }
};
function aliasedTable(table, tableAlias) {
  return new Proxy(table, new TableAliasProxyHandler(tableAlias, false));
}
function aliasedTableColumn(column, tableAlias) {
  return new Proxy(
    column,
    new ColumnAliasProxyHandler(new Proxy(column.table, new TableAliasProxyHandler(tableAlias, false)))
  );
}
function mapColumnsInAliasedSQLToAlias(query, alias) {
  return new SQL.Aliased(mapColumnsInSQLToAlias(query.sql, alias), query.fieldAlias);
}
function mapColumnsInSQLToAlias(query, alias) {
  return sql.join(query.queryChunks.map((c) => {
    if (is(c, Column)) {
      return aliasedTableColumn(c, alias);
    }
    if (is(c, SQL)) {
      return mapColumnsInSQLToAlias(c, alias);
    }
    if (is(c, SQL.Aliased)) {
      return mapColumnsInAliasedSQLToAlias(c, alias);
    }
    return c;
  }));
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/errors.js
var DrizzleError = class extends Error {
  static [entityKind] = "DrizzleError";
  constructor({ message, cause }) {
    super(message);
    this.name = "DrizzleError";
    this.cause = cause;
  }
};
var DrizzleQueryError = class _DrizzleQueryError extends Error {
  constructor(query, params, cause) {
    super(`Failed query: ${query}
params: ${params}`);
    this.query = query;
    this.params = params;
    this.cause = cause;
    Error.captureStackTrace(this, _DrizzleQueryError);
    if (cause) this.cause = cause;
  }
};
var TransactionRollbackError = class extends DrizzleError {
  static [entityKind] = "TransactionRollbackError";
  constructor() {
    super({ message: "Rollback" });
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/logger.js
var ConsoleLogWriter = class {
  static [entityKind] = "ConsoleLogWriter";
  write(message) {
    console.log(message);
  }
};
var DefaultLogger = class {
  static [entityKind] = "DefaultLogger";
  writer;
  constructor(config) {
    this.writer = config?.writer ?? new ConsoleLogWriter();
  }
  logQuery(query, params) {
    const stringifiedParams = params.map((p) => {
      try {
        return JSON.stringify(p);
      } catch {
        return String(p);
      }
    });
    const paramsStr = stringifiedParams.length ? ` -- params: [${stringifiedParams.join(", ")}]` : "";
    this.writer.write(`Query: ${query}${paramsStr}`);
  }
};
var NoopLogger = class {
  static [entityKind] = "NoopLogger";
  logQuery() {
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/query-promise.js
var QueryPromise = class {
  static [entityKind] = "QueryPromise";
  [Symbol.toStringTag] = "QueryPromise";
  catch(onRejected) {
    return this.then(void 0, onRejected);
  }
  finally(onFinally) {
    return this.then(
      (value) => {
        onFinally?.();
        return value;
      },
      (reason) => {
        onFinally?.();
        throw reason;
      }
    );
  }
  then(onFulfilled, onRejected) {
    return this.execute().then(onFulfilled, onRejected);
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/utils.js
function mapResultRow(columns, row, joinsNotNullableMap) {
  const nullifyMap = {};
  const result = columns.reduce(
    (result2, { path, field }, columnIndex) => {
      let decoder;
      if (is(field, Column)) {
        decoder = field;
      } else if (is(field, SQL)) {
        decoder = field.decoder;
      } else if (is(field, Subquery)) {
        decoder = field._.sql.decoder;
      } else {
        decoder = field.sql.decoder;
      }
      let node = result2;
      for (const [pathChunkIndex, pathChunk] of path.entries()) {
        if (pathChunkIndex < path.length - 1) {
          if (!(pathChunk in node)) {
            node[pathChunk] = {};
          }
          node = node[pathChunk];
        } else {
          const rawValue = row[columnIndex];
          const value = node[pathChunk] = rawValue === null ? null : decoder.mapFromDriverValue(rawValue);
          if (joinsNotNullableMap && is(field, Column) && path.length === 2) {
            const objectName = path[0];
            if (!(objectName in nullifyMap)) {
              nullifyMap[objectName] = value === null ? getTableName(field.table) : false;
            } else if (typeof nullifyMap[objectName] === "string" && nullifyMap[objectName] !== getTableName(field.table)) {
              nullifyMap[objectName] = false;
            }
          }
        }
      }
      return result2;
    },
    {}
  );
  if (joinsNotNullableMap && Object.keys(nullifyMap).length > 0) {
    for (const [objectName, tableName] of Object.entries(nullifyMap)) {
      if (typeof tableName === "string" && !joinsNotNullableMap[tableName]) {
        result[objectName] = null;
      }
    }
  }
  return result;
}
function orderSelectedFields(fields, pathPrefix) {
  return Object.entries(fields).reduce((result, [name, field]) => {
    if (typeof name !== "string") {
      return result;
    }
    const newPath = pathPrefix ? [...pathPrefix, name] : [name];
    if (is(field, Column) || is(field, SQL) || is(field, SQL.Aliased) || is(field, Subquery)) {
      result.push({ path: newPath, field });
    } else if (is(field, Table)) {
      result.push(...orderSelectedFields(field[Table.Symbol.Columns], newPath));
    } else {
      result.push(...orderSelectedFields(field, newPath));
    }
    return result;
  }, []);
}
function haveSameKeys(left, right) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const [index2, key] of leftKeys.entries()) {
    if (key !== rightKeys[index2]) {
      return false;
    }
  }
  return true;
}
function mapUpdateSet(table, values2) {
  const entries = Object.entries(values2).filter(([, value]) => value !== void 0).map(([key, value]) => {
    if (is(value, SQL) || is(value, Column)) {
      return [key, value];
    } else {
      return [key, new Param(value, table[Table.Symbol.Columns][key])];
    }
  });
  if (entries.length === 0) {
    throw new Error("No values to set");
  }
  return Object.fromEntries(entries);
}
function applyMixins(baseClass, extendedClasses) {
  for (const extendedClass of extendedClasses) {
    for (const name of Object.getOwnPropertyNames(extendedClass.prototype)) {
      if (name === "constructor") continue;
      Object.defineProperty(
        baseClass.prototype,
        name,
        Object.getOwnPropertyDescriptor(extendedClass.prototype, name) || /* @__PURE__ */ Object.create(null)
      );
    }
  }
}
function getTableColumns(table) {
  return table[Table.Symbol.Columns];
}
function getTableLikeName(table) {
  return is(table, Subquery) ? table._.alias : is(table, View) ? table[ViewBaseConfig].name : is(table, SQL) ? void 0 : table[Table.Symbol.IsAlias] ? table[Table.Symbol.Name] : table[Table.Symbol.BaseName];
}
function getColumnNameAndConfig(a, b2) {
  return {
    name: typeof a === "string" && a.length > 0 ? a : "",
    config: typeof a === "object" ? a : b2
  };
}
function isConfig(data) {
  if (typeof data !== "object" || data === null) return false;
  if (data.constructor.name !== "Object") return false;
  if ("logger" in data) {
    const type = typeof data["logger"];
    if (type !== "boolean" && (type !== "object" || typeof data["logger"]["logQuery"] !== "function") && type !== "undefined") return false;
    return true;
  }
  if ("schema" in data) {
    const type = typeof data["schema"];
    if (type !== "object" && type !== "undefined") return false;
    return true;
  }
  if ("casing" in data) {
    const type = typeof data["casing"];
    if (type !== "string" && type !== "undefined") return false;
    return true;
  }
  if ("mode" in data) {
    if (data["mode"] !== "default" || data["mode"] !== "planetscale" || data["mode"] !== void 0) return false;
    return true;
  }
  if ("connection" in data) {
    const type = typeof data["connection"];
    if (type !== "string" && type !== "object" && type !== "undefined") return false;
    return true;
  }
  if ("client" in data) {
    const type = typeof data["client"];
    if (type !== "object" && type !== "function" && type !== "undefined") return false;
    return true;
  }
  if (Object.keys(data).length === 0) return true;
  return false;
}
var textDecoder = typeof TextDecoder === "undefined" ? null : new TextDecoder();

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/int.common.js
var PgIntColumnBaseBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgIntColumnBaseBuilder";
  generatedAlwaysAsIdentity(sequence) {
    if (sequence) {
      const { name, ...options } = sequence;
      this.config.generatedIdentity = {
        type: "always",
        sequenceName: name,
        sequenceOptions: options
      };
    } else {
      this.config.generatedIdentity = {
        type: "always"
      };
    }
    this.config.hasDefault = true;
    this.config.notNull = true;
    return this;
  }
  generatedByDefaultAsIdentity(sequence) {
    if (sequence) {
      const { name, ...options } = sequence;
      this.config.generatedIdentity = {
        type: "byDefault",
        sequenceName: name,
        sequenceOptions: options
      };
    } else {
      this.config.generatedIdentity = {
        type: "byDefault"
      };
    }
    this.config.hasDefault = true;
    this.config.notNull = true;
    return this;
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/bigint.js
var PgBigInt53Builder = class extends PgIntColumnBaseBuilder {
  static [entityKind] = "PgBigInt53Builder";
  constructor(name) {
    super(name, "number", "PgBigInt53");
  }
  /** @internal */
  build(table) {
    return new PgBigInt53(table, this.config);
  }
};
var PgBigInt53 = class extends PgColumn {
  static [entityKind] = "PgBigInt53";
  getSQLType() {
    return "bigint";
  }
  mapFromDriverValue(value) {
    if (typeof value === "number") {
      return value;
    }
    return Number(value);
  }
};
var PgBigInt64Builder = class extends PgIntColumnBaseBuilder {
  static [entityKind] = "PgBigInt64Builder";
  constructor(name) {
    super(name, "bigint", "PgBigInt64");
  }
  /** @internal */
  build(table) {
    return new PgBigInt64(
      table,
      this.config
    );
  }
};
var PgBigInt64 = class extends PgColumn {
  static [entityKind] = "PgBigInt64";
  getSQLType() {
    return "bigint";
  }
  // eslint-disable-next-line unicorn/prefer-native-coercion-functions
  mapFromDriverValue(value) {
    return BigInt(value);
  }
};
function bigint(a, b2) {
  const { name, config } = getColumnNameAndConfig(a, b2);
  if (config.mode === "number") {
    return new PgBigInt53Builder(name);
  }
  return new PgBigInt64Builder(name);
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/bigserial.js
var PgBigSerial53Builder = class extends PgColumnBuilder {
  static [entityKind] = "PgBigSerial53Builder";
  constructor(name) {
    super(name, "number", "PgBigSerial53");
    this.config.hasDefault = true;
    this.config.notNull = true;
  }
  /** @internal */
  build(table) {
    return new PgBigSerial53(
      table,
      this.config
    );
  }
};
var PgBigSerial53 = class extends PgColumn {
  static [entityKind] = "PgBigSerial53";
  getSQLType() {
    return "bigserial";
  }
  mapFromDriverValue(value) {
    if (typeof value === "number") {
      return value;
    }
    return Number(value);
  }
};
var PgBigSerial64Builder = class extends PgColumnBuilder {
  static [entityKind] = "PgBigSerial64Builder";
  constructor(name) {
    super(name, "bigint", "PgBigSerial64");
    this.config.hasDefault = true;
  }
  /** @internal */
  build(table) {
    return new PgBigSerial64(
      table,
      this.config
    );
  }
};
var PgBigSerial64 = class extends PgColumn {
  static [entityKind] = "PgBigSerial64";
  getSQLType() {
    return "bigserial";
  }
  // eslint-disable-next-line unicorn/prefer-native-coercion-functions
  mapFromDriverValue(value) {
    return BigInt(value);
  }
};
function bigserial(a, b2) {
  const { name, config } = getColumnNameAndConfig(a, b2);
  if (config.mode === "number") {
    return new PgBigSerial53Builder(name);
  }
  return new PgBigSerial64Builder(name);
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/boolean.js
var PgBooleanBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgBooleanBuilder";
  constructor(name) {
    super(name, "boolean", "PgBoolean");
  }
  /** @internal */
  build(table) {
    return new PgBoolean(table, this.config);
  }
};
var PgBoolean = class extends PgColumn {
  static [entityKind] = "PgBoolean";
  getSQLType() {
    return "boolean";
  }
};
function boolean(name) {
  return new PgBooleanBuilder(name ?? "");
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/char.js
var PgCharBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgCharBuilder";
  constructor(name, config) {
    super(name, "string", "PgChar");
    this.config.length = config.length;
    this.config.enumValues = config.enum;
  }
  /** @internal */
  build(table) {
    return new PgChar(
      table,
      this.config
    );
  }
};
var PgChar = class extends PgColumn {
  static [entityKind] = "PgChar";
  length = this.config.length;
  enumValues = this.config.enumValues;
  getSQLType() {
    return this.length === void 0 ? `char` : `char(${this.length})`;
  }
};
function char(a, b2 = {}) {
  const { name, config } = getColumnNameAndConfig(a, b2);
  return new PgCharBuilder(name, config);
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/cidr.js
var PgCidrBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgCidrBuilder";
  constructor(name) {
    super(name, "string", "PgCidr");
  }
  /** @internal */
  build(table) {
    return new PgCidr(table, this.config);
  }
};
var PgCidr = class extends PgColumn {
  static [entityKind] = "PgCidr";
  getSQLType() {
    return "cidr";
  }
};
function cidr(name) {
  return new PgCidrBuilder(name ?? "");
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/custom.js
var PgCustomColumnBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgCustomColumnBuilder";
  constructor(name, fieldConfig, customTypeParams) {
    super(name, "custom", "PgCustomColumn");
    this.config.fieldConfig = fieldConfig;
    this.config.customTypeParams = customTypeParams;
  }
  /** @internal */
  build(table) {
    return new PgCustomColumn(
      table,
      this.config
    );
  }
};
var PgCustomColumn = class extends PgColumn {
  static [entityKind] = "PgCustomColumn";
  sqlName;
  mapTo;
  mapFrom;
  constructor(table, config) {
    super(table, config);
    this.sqlName = config.customTypeParams.dataType(config.fieldConfig);
    this.mapTo = config.customTypeParams.toDriver;
    this.mapFrom = config.customTypeParams.fromDriver;
  }
  getSQLType() {
    return this.sqlName;
  }
  mapFromDriverValue(value) {
    return typeof this.mapFrom === "function" ? this.mapFrom(value) : value;
  }
  mapToDriverValue(value) {
    return typeof this.mapTo === "function" ? this.mapTo(value) : value;
  }
};
function customType(customTypeParams) {
  return (a, b2) => {
    const { name, config } = getColumnNameAndConfig(a, b2);
    return new PgCustomColumnBuilder(name, config, customTypeParams);
  };
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/date.common.js
var PgDateColumnBaseBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgDateColumnBaseBuilder";
  defaultNow() {
    return this.default(sql`now()`);
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/date.js
var PgDateBuilder = class extends PgDateColumnBaseBuilder {
  static [entityKind] = "PgDateBuilder";
  constructor(name) {
    super(name, "date", "PgDate");
  }
  /** @internal */
  build(table) {
    return new PgDate(table, this.config);
  }
};
var PgDate = class extends PgColumn {
  static [entityKind] = "PgDate";
  getSQLType() {
    return "date";
  }
  mapFromDriverValue(value) {
    if (typeof value === "string") return new Date(value);
    return value;
  }
  mapToDriverValue(value) {
    return value.toISOString();
  }
};
var PgDateStringBuilder = class extends PgDateColumnBaseBuilder {
  static [entityKind] = "PgDateStringBuilder";
  constructor(name) {
    super(name, "string", "PgDateString");
  }
  /** @internal */
  build(table) {
    return new PgDateString(
      table,
      this.config
    );
  }
};
var PgDateString = class extends PgColumn {
  static [entityKind] = "PgDateString";
  getSQLType() {
    return "date";
  }
  mapFromDriverValue(value) {
    if (typeof value === "string") return value;
    return value.toISOString().slice(0, -14);
  }
};
function date(a, b2) {
  const { name, config } = getColumnNameAndConfig(a, b2);
  if (config?.mode === "date") {
    return new PgDateBuilder(name);
  }
  return new PgDateStringBuilder(name);
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/double-precision.js
var PgDoublePrecisionBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgDoublePrecisionBuilder";
  constructor(name) {
    super(name, "number", "PgDoublePrecision");
  }
  /** @internal */
  build(table) {
    return new PgDoublePrecision(
      table,
      this.config
    );
  }
};
var PgDoublePrecision = class extends PgColumn {
  static [entityKind] = "PgDoublePrecision";
  getSQLType() {
    return "double precision";
  }
  mapFromDriverValue(value) {
    if (typeof value === "string") {
      return Number.parseFloat(value);
    }
    return value;
  }
};
function doublePrecision(name) {
  return new PgDoublePrecisionBuilder(name ?? "");
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/inet.js
var PgInetBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgInetBuilder";
  constructor(name) {
    super(name, "string", "PgInet");
  }
  /** @internal */
  build(table) {
    return new PgInet(table, this.config);
  }
};
var PgInet = class extends PgColumn {
  static [entityKind] = "PgInet";
  getSQLType() {
    return "inet";
  }
};
function inet(name) {
  return new PgInetBuilder(name ?? "");
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/integer.js
var PgIntegerBuilder = class extends PgIntColumnBaseBuilder {
  static [entityKind] = "PgIntegerBuilder";
  constructor(name) {
    super(name, "number", "PgInteger");
  }
  /** @internal */
  build(table) {
    return new PgInteger(table, this.config);
  }
};
var PgInteger = class extends PgColumn {
  static [entityKind] = "PgInteger";
  getSQLType() {
    return "integer";
  }
  mapFromDriverValue(value) {
    if (typeof value === "string") {
      return Number.parseInt(value);
    }
    return value;
  }
};
function integer(name) {
  return new PgIntegerBuilder(name ?? "");
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/interval.js
var PgIntervalBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgIntervalBuilder";
  constructor(name, intervalConfig) {
    super(name, "string", "PgInterval");
    this.config.intervalConfig = intervalConfig;
  }
  /** @internal */
  build(table) {
    return new PgInterval(table, this.config);
  }
};
var PgInterval = class extends PgColumn {
  static [entityKind] = "PgInterval";
  fields = this.config.intervalConfig.fields;
  precision = this.config.intervalConfig.precision;
  getSQLType() {
    const fields = this.fields ? ` ${this.fields}` : "";
    const precision = this.precision ? `(${this.precision})` : "";
    return `interval${fields}${precision}`;
  }
};
function interval(a, b2 = {}) {
  const { name, config } = getColumnNameAndConfig(a, b2);
  return new PgIntervalBuilder(name, config);
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/json.js
var PgJsonBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgJsonBuilder";
  constructor(name) {
    super(name, "json", "PgJson");
  }
  /** @internal */
  build(table) {
    return new PgJson(table, this.config);
  }
};
var PgJson = class extends PgColumn {
  static [entityKind] = "PgJson";
  constructor(table, config) {
    super(table, config);
  }
  getSQLType() {
    return "json";
  }
  mapToDriverValue(value) {
    return JSON.stringify(value);
  }
  mapFromDriverValue(value) {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }
};
function json(name) {
  return new PgJsonBuilder(name ?? "");
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/jsonb.js
var PgJsonbBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgJsonbBuilder";
  constructor(name) {
    super(name, "json", "PgJsonb");
  }
  /** @internal */
  build(table) {
    return new PgJsonb(table, this.config);
  }
};
var PgJsonb = class extends PgColumn {
  static [entityKind] = "PgJsonb";
  constructor(table, config) {
    super(table, config);
  }
  getSQLType() {
    return "jsonb";
  }
  mapToDriverValue(value) {
    return JSON.stringify(value);
  }
  mapFromDriverValue(value) {
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }
};
function jsonb(name) {
  return new PgJsonbBuilder(name ?? "");
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/line.js
var PgLineBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgLineBuilder";
  constructor(name) {
    super(name, "array", "PgLine");
  }
  /** @internal */
  build(table) {
    return new PgLineTuple(
      table,
      this.config
    );
  }
};
var PgLineTuple = class extends PgColumn {
  static [entityKind] = "PgLine";
  getSQLType() {
    return "line";
  }
  mapFromDriverValue(value) {
    const [a, b2, c] = value.slice(1, -1).split(",");
    return [Number.parseFloat(a), Number.parseFloat(b2), Number.parseFloat(c)];
  }
  mapToDriverValue(value) {
    return `{${value[0]},${value[1]},${value[2]}}`;
  }
};
var PgLineABCBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgLineABCBuilder";
  constructor(name) {
    super(name, "json", "PgLineABC");
  }
  /** @internal */
  build(table) {
    return new PgLineABC(
      table,
      this.config
    );
  }
};
var PgLineABC = class extends PgColumn {
  static [entityKind] = "PgLineABC";
  getSQLType() {
    return "line";
  }
  mapFromDriverValue(value) {
    const [a, b2, c] = value.slice(1, -1).split(",");
    return { a: Number.parseFloat(a), b: Number.parseFloat(b2), c: Number.parseFloat(c) };
  }
  mapToDriverValue(value) {
    return `{${value.a},${value.b},${value.c}}`;
  }
};
function line(a, b2) {
  const { name, config } = getColumnNameAndConfig(a, b2);
  if (!config?.mode || config.mode === "tuple") {
    return new PgLineBuilder(name);
  }
  return new PgLineABCBuilder(name);
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/macaddr.js
var PgMacaddrBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgMacaddrBuilder";
  constructor(name) {
    super(name, "string", "PgMacaddr");
  }
  /** @internal */
  build(table) {
    return new PgMacaddr(table, this.config);
  }
};
var PgMacaddr = class extends PgColumn {
  static [entityKind] = "PgMacaddr";
  getSQLType() {
    return "macaddr";
  }
};
function macaddr(name) {
  return new PgMacaddrBuilder(name ?? "");
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/macaddr8.js
var PgMacaddr8Builder = class extends PgColumnBuilder {
  static [entityKind] = "PgMacaddr8Builder";
  constructor(name) {
    super(name, "string", "PgMacaddr8");
  }
  /** @internal */
  build(table) {
    return new PgMacaddr8(table, this.config);
  }
};
var PgMacaddr8 = class extends PgColumn {
  static [entityKind] = "PgMacaddr8";
  getSQLType() {
    return "macaddr8";
  }
};
function macaddr8(name) {
  return new PgMacaddr8Builder(name ?? "");
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/numeric.js
var PgNumericBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgNumericBuilder";
  constructor(name, precision, scale) {
    super(name, "string", "PgNumeric");
    this.config.precision = precision;
    this.config.scale = scale;
  }
  /** @internal */
  build(table) {
    return new PgNumeric(table, this.config);
  }
};
var PgNumeric = class extends PgColumn {
  static [entityKind] = "PgNumeric";
  precision;
  scale;
  constructor(table, config) {
    super(table, config);
    this.precision = config.precision;
    this.scale = config.scale;
  }
  mapFromDriverValue(value) {
    if (typeof value === "string") return value;
    return String(value);
  }
  getSQLType() {
    if (this.precision !== void 0 && this.scale !== void 0) {
      return `numeric(${this.precision}, ${this.scale})`;
    } else if (this.precision === void 0) {
      return "numeric";
    } else {
      return `numeric(${this.precision})`;
    }
  }
};
var PgNumericNumberBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgNumericNumberBuilder";
  constructor(name, precision, scale) {
    super(name, "number", "PgNumericNumber");
    this.config.precision = precision;
    this.config.scale = scale;
  }
  /** @internal */
  build(table) {
    return new PgNumericNumber(
      table,
      this.config
    );
  }
};
var PgNumericNumber = class extends PgColumn {
  static [entityKind] = "PgNumericNumber";
  precision;
  scale;
  constructor(table, config) {
    super(table, config);
    this.precision = config.precision;
    this.scale = config.scale;
  }
  mapFromDriverValue(value) {
    if (typeof value === "number") return value;
    return Number(value);
  }
  mapToDriverValue = String;
  getSQLType() {
    if (this.precision !== void 0 && this.scale !== void 0) {
      return `numeric(${this.precision}, ${this.scale})`;
    } else if (this.precision === void 0) {
      return "numeric";
    } else {
      return `numeric(${this.precision})`;
    }
  }
};
var PgNumericBigIntBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgNumericBigIntBuilder";
  constructor(name, precision, scale) {
    super(name, "bigint", "PgNumericBigInt");
    this.config.precision = precision;
    this.config.scale = scale;
  }
  /** @internal */
  build(table) {
    return new PgNumericBigInt(
      table,
      this.config
    );
  }
};
var PgNumericBigInt = class extends PgColumn {
  static [entityKind] = "PgNumericBigInt";
  precision;
  scale;
  constructor(table, config) {
    super(table, config);
    this.precision = config.precision;
    this.scale = config.scale;
  }
  mapFromDriverValue = BigInt;
  mapToDriverValue = String;
  getSQLType() {
    if (this.precision !== void 0 && this.scale !== void 0) {
      return `numeric(${this.precision}, ${this.scale})`;
    } else if (this.precision === void 0) {
      return "numeric";
    } else {
      return `numeric(${this.precision})`;
    }
  }
};
function numeric(a, b2) {
  const { name, config } = getColumnNameAndConfig(a, b2);
  const mode = config?.mode;
  return mode === "number" ? new PgNumericNumberBuilder(name, config?.precision, config?.scale) : mode === "bigint" ? new PgNumericBigIntBuilder(name, config?.precision, config?.scale) : new PgNumericBuilder(name, config?.precision, config?.scale);
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/point.js
var PgPointTupleBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgPointTupleBuilder";
  constructor(name) {
    super(name, "array", "PgPointTuple");
  }
  /** @internal */
  build(table) {
    return new PgPointTuple(
      table,
      this.config
    );
  }
};
var PgPointTuple = class extends PgColumn {
  static [entityKind] = "PgPointTuple";
  getSQLType() {
    return "point";
  }
  mapFromDriverValue(value) {
    if (typeof value === "string") {
      const [x, y] = value.slice(1, -1).split(",");
      return [Number.parseFloat(x), Number.parseFloat(y)];
    }
    return [value.x, value.y];
  }
  mapToDriverValue(value) {
    return `(${value[0]},${value[1]})`;
  }
};
var PgPointObjectBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgPointObjectBuilder";
  constructor(name) {
    super(name, "json", "PgPointObject");
  }
  /** @internal */
  build(table) {
    return new PgPointObject(
      table,
      this.config
    );
  }
};
var PgPointObject = class extends PgColumn {
  static [entityKind] = "PgPointObject";
  getSQLType() {
    return "point";
  }
  mapFromDriverValue(value) {
    if (typeof value === "string") {
      const [x, y] = value.slice(1, -1).split(",");
      return { x: Number.parseFloat(x), y: Number.parseFloat(y) };
    }
    return value;
  }
  mapToDriverValue(value) {
    return `(${value.x},${value.y})`;
  }
};
function point(a, b2) {
  const { name, config } = getColumnNameAndConfig(a, b2);
  if (!config?.mode || config.mode === "tuple") {
    return new PgPointTupleBuilder(name);
  }
  return new PgPointObjectBuilder(name);
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/postgis_extension/utils.js
function hexToBytes(hex) {
  const bytes = [];
  for (let c = 0; c < hex.length; c += 2) {
    bytes.push(Number.parseInt(hex.slice(c, c + 2), 16));
  }
  return new Uint8Array(bytes);
}
function bytesToFloat64(bytes, offset) {
  const buffer2 = new ArrayBuffer(8);
  const view = new DataView(buffer2);
  for (let i = 0; i < 8; i++) {
    view.setUint8(i, bytes[offset + i]);
  }
  return view.getFloat64(0, true);
}
function parseEWKB(hex) {
  const bytes = hexToBytes(hex);
  let offset = 0;
  const byteOrder = bytes[offset];
  offset += 1;
  const view = new DataView(bytes.buffer);
  const geomType = view.getUint32(offset, byteOrder === 1);
  offset += 4;
  let _srid;
  if (geomType & 536870912) {
    _srid = view.getUint32(offset, byteOrder === 1);
    offset += 4;
  }
  if ((geomType & 65535) === 1) {
    const x = bytesToFloat64(bytes, offset);
    offset += 8;
    const y = bytesToFloat64(bytes, offset);
    offset += 8;
    return [x, y];
  }
  throw new Error("Unsupported geometry type");
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/postgis_extension/geometry.js
var PgGeometryBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgGeometryBuilder";
  constructor(name) {
    super(name, "array", "PgGeometry");
  }
  /** @internal */
  build(table) {
    return new PgGeometry(
      table,
      this.config
    );
  }
};
var PgGeometry = class extends PgColumn {
  static [entityKind] = "PgGeometry";
  getSQLType() {
    return "geometry(point)";
  }
  mapFromDriverValue(value) {
    return parseEWKB(value);
  }
  mapToDriverValue(value) {
    return `point(${value[0]} ${value[1]})`;
  }
};
var PgGeometryObjectBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgGeometryObjectBuilder";
  constructor(name) {
    super(name, "json", "PgGeometryObject");
  }
  /** @internal */
  build(table) {
    return new PgGeometryObject(
      table,
      this.config
    );
  }
};
var PgGeometryObject = class extends PgColumn {
  static [entityKind] = "PgGeometryObject";
  getSQLType() {
    return "geometry(point)";
  }
  mapFromDriverValue(value) {
    const parsed = parseEWKB(value);
    return { x: parsed[0], y: parsed[1] };
  }
  mapToDriverValue(value) {
    return `point(${value.x} ${value.y})`;
  }
};
function geometry(a, b2) {
  const { name, config } = getColumnNameAndConfig(a, b2);
  if (!config?.mode || config.mode === "tuple") {
    return new PgGeometryBuilder(name);
  }
  return new PgGeometryObjectBuilder(name);
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/real.js
var PgRealBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgRealBuilder";
  constructor(name, length) {
    super(name, "number", "PgReal");
    this.config.length = length;
  }
  /** @internal */
  build(table) {
    return new PgReal(table, this.config);
  }
};
var PgReal = class extends PgColumn {
  static [entityKind] = "PgReal";
  constructor(table, config) {
    super(table, config);
  }
  getSQLType() {
    return "real";
  }
  mapFromDriverValue = (value) => {
    if (typeof value === "string") {
      return Number.parseFloat(value);
    }
    return value;
  };
};
function real(name) {
  return new PgRealBuilder(name ?? "");
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/serial.js
var PgSerialBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgSerialBuilder";
  constructor(name) {
    super(name, "number", "PgSerial");
    this.config.hasDefault = true;
    this.config.notNull = true;
  }
  /** @internal */
  build(table) {
    return new PgSerial(table, this.config);
  }
};
var PgSerial = class extends PgColumn {
  static [entityKind] = "PgSerial";
  getSQLType() {
    return "serial";
  }
};
function serial(name) {
  return new PgSerialBuilder(name ?? "");
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/smallint.js
var PgSmallIntBuilder = class extends PgIntColumnBaseBuilder {
  static [entityKind] = "PgSmallIntBuilder";
  constructor(name) {
    super(name, "number", "PgSmallInt");
  }
  /** @internal */
  build(table) {
    return new PgSmallInt(table, this.config);
  }
};
var PgSmallInt = class extends PgColumn {
  static [entityKind] = "PgSmallInt";
  getSQLType() {
    return "smallint";
  }
  mapFromDriverValue = (value) => {
    if (typeof value === "string") {
      return Number(value);
    }
    return value;
  };
};
function smallint(name) {
  return new PgSmallIntBuilder(name ?? "");
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/smallserial.js
var PgSmallSerialBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgSmallSerialBuilder";
  constructor(name) {
    super(name, "number", "PgSmallSerial");
    this.config.hasDefault = true;
    this.config.notNull = true;
  }
  /** @internal */
  build(table) {
    return new PgSmallSerial(
      table,
      this.config
    );
  }
};
var PgSmallSerial = class extends PgColumn {
  static [entityKind] = "PgSmallSerial";
  getSQLType() {
    return "smallserial";
  }
};
function smallserial(name) {
  return new PgSmallSerialBuilder(name ?? "");
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/text.js
var PgTextBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgTextBuilder";
  constructor(name, config) {
    super(name, "string", "PgText");
    this.config.enumValues = config.enum;
  }
  /** @internal */
  build(table) {
    return new PgText(table, this.config);
  }
};
var PgText = class extends PgColumn {
  static [entityKind] = "PgText";
  enumValues = this.config.enumValues;
  getSQLType() {
    return "text";
  }
};
function text(a, b2 = {}) {
  const { name, config } = getColumnNameAndConfig(a, b2);
  return new PgTextBuilder(name, config);
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/time.js
var PgTimeBuilder = class extends PgDateColumnBaseBuilder {
  constructor(name, withTimezone, precision) {
    super(name, "string", "PgTime");
    this.withTimezone = withTimezone;
    this.precision = precision;
    this.config.withTimezone = withTimezone;
    this.config.precision = precision;
  }
  static [entityKind] = "PgTimeBuilder";
  /** @internal */
  build(table) {
    return new PgTime(table, this.config);
  }
};
var PgTime = class extends PgColumn {
  static [entityKind] = "PgTime";
  withTimezone;
  precision;
  constructor(table, config) {
    super(table, config);
    this.withTimezone = config.withTimezone;
    this.precision = config.precision;
  }
  getSQLType() {
    const precision = this.precision === void 0 ? "" : `(${this.precision})`;
    return `time${precision}${this.withTimezone ? " with time zone" : ""}`;
  }
};
function time(a, b2 = {}) {
  const { name, config } = getColumnNameAndConfig(a, b2);
  return new PgTimeBuilder(name, config.withTimezone ?? false, config.precision);
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/timestamp.js
var PgTimestampBuilder = class extends PgDateColumnBaseBuilder {
  static [entityKind] = "PgTimestampBuilder";
  constructor(name, withTimezone, precision) {
    super(name, "date", "PgTimestamp");
    this.config.withTimezone = withTimezone;
    this.config.precision = precision;
  }
  /** @internal */
  build(table) {
    return new PgTimestamp(table, this.config);
  }
};
var PgTimestamp = class extends PgColumn {
  static [entityKind] = "PgTimestamp";
  withTimezone;
  precision;
  constructor(table, config) {
    super(table, config);
    this.withTimezone = config.withTimezone;
    this.precision = config.precision;
  }
  getSQLType() {
    const precision = this.precision === void 0 ? "" : ` (${this.precision})`;
    return `timestamp${precision}${this.withTimezone ? " with time zone" : ""}`;
  }
  mapFromDriverValue(value) {
    if (typeof value === "string") return new Date(this.withTimezone ? value : value + "+0000");
    return value;
  }
  mapToDriverValue = (value) => {
    return value.toISOString();
  };
};
var PgTimestampStringBuilder = class extends PgDateColumnBaseBuilder {
  static [entityKind] = "PgTimestampStringBuilder";
  constructor(name, withTimezone, precision) {
    super(name, "string", "PgTimestampString");
    this.config.withTimezone = withTimezone;
    this.config.precision = precision;
  }
  /** @internal */
  build(table) {
    return new PgTimestampString(
      table,
      this.config
    );
  }
};
var PgTimestampString = class extends PgColumn {
  static [entityKind] = "PgTimestampString";
  withTimezone;
  precision;
  constructor(table, config) {
    super(table, config);
    this.withTimezone = config.withTimezone;
    this.precision = config.precision;
  }
  getSQLType() {
    const precision = this.precision === void 0 ? "" : `(${this.precision})`;
    return `timestamp${precision}${this.withTimezone ? " with time zone" : ""}`;
  }
  mapFromDriverValue(value) {
    if (typeof value === "string") return value;
    const shortened = value.toISOString().slice(0, -1).replace("T", " ");
    if (this.withTimezone) {
      const offset = value.getTimezoneOffset();
      const sign = offset <= 0 ? "+" : "-";
      return `${shortened}${sign}${Math.floor(Math.abs(offset) / 60).toString().padStart(2, "0")}`;
    }
    return shortened;
  }
};
function timestamp(a, b2 = {}) {
  const { name, config } = getColumnNameAndConfig(a, b2);
  if (config?.mode === "string") {
    return new PgTimestampStringBuilder(name, config.withTimezone ?? false, config.precision);
  }
  return new PgTimestampBuilder(name, config?.withTimezone ?? false, config?.precision);
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/uuid.js
var PgUUIDBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgUUIDBuilder";
  constructor(name) {
    super(name, "string", "PgUUID");
  }
  /**
   * Adds `default gen_random_uuid()` to the column definition.
   */
  defaultRandom() {
    return this.default(sql`gen_random_uuid()`);
  }
  /** @internal */
  build(table) {
    return new PgUUID(table, this.config);
  }
};
var PgUUID = class extends PgColumn {
  static [entityKind] = "PgUUID";
  getSQLType() {
    return "uuid";
  }
};
function uuid(name) {
  return new PgUUIDBuilder(name ?? "");
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/varchar.js
var PgVarcharBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgVarcharBuilder";
  constructor(name, config) {
    super(name, "string", "PgVarchar");
    this.config.length = config.length;
    this.config.enumValues = config.enum;
  }
  /** @internal */
  build(table) {
    return new PgVarchar(
      table,
      this.config
    );
  }
};
var PgVarchar = class extends PgColumn {
  static [entityKind] = "PgVarchar";
  length = this.config.length;
  enumValues = this.config.enumValues;
  getSQLType() {
    return this.length === void 0 ? `varchar` : `varchar(${this.length})`;
  }
};
function varchar(a, b2 = {}) {
  const { name, config } = getColumnNameAndConfig(a, b2);
  return new PgVarcharBuilder(name, config);
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/vector_extension/bit.js
var PgBinaryVectorBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgBinaryVectorBuilder";
  constructor(name, config) {
    super(name, "string", "PgBinaryVector");
    this.config.dimensions = config.dimensions;
  }
  /** @internal */
  build(table) {
    return new PgBinaryVector(
      table,
      this.config
    );
  }
};
var PgBinaryVector = class extends PgColumn {
  static [entityKind] = "PgBinaryVector";
  dimensions = this.config.dimensions;
  getSQLType() {
    return `bit(${this.dimensions})`;
  }
};
function bit(a, b2) {
  const { name, config } = getColumnNameAndConfig(a, b2);
  return new PgBinaryVectorBuilder(name, config);
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/vector_extension/halfvec.js
var PgHalfVectorBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgHalfVectorBuilder";
  constructor(name, config) {
    super(name, "array", "PgHalfVector");
    this.config.dimensions = config.dimensions;
  }
  /** @internal */
  build(table) {
    return new PgHalfVector(
      table,
      this.config
    );
  }
};
var PgHalfVector = class extends PgColumn {
  static [entityKind] = "PgHalfVector";
  dimensions = this.config.dimensions;
  getSQLType() {
    return `halfvec(${this.dimensions})`;
  }
  mapToDriverValue(value) {
    return JSON.stringify(value);
  }
  mapFromDriverValue(value) {
    return value.slice(1, -1).split(",").map((v) => Number.parseFloat(v));
  }
};
function halfvec(a, b2) {
  const { name, config } = getColumnNameAndConfig(a, b2);
  return new PgHalfVectorBuilder(name, config);
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/vector_extension/sparsevec.js
var PgSparseVectorBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgSparseVectorBuilder";
  constructor(name, config) {
    super(name, "string", "PgSparseVector");
    this.config.dimensions = config.dimensions;
  }
  /** @internal */
  build(table) {
    return new PgSparseVector(
      table,
      this.config
    );
  }
};
var PgSparseVector = class extends PgColumn {
  static [entityKind] = "PgSparseVector";
  dimensions = this.config.dimensions;
  getSQLType() {
    return `sparsevec(${this.dimensions})`;
  }
};
function sparsevec(a, b2) {
  const { name, config } = getColumnNameAndConfig(a, b2);
  return new PgSparseVectorBuilder(name, config);
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/vector_extension/vector.js
var PgVectorBuilder = class extends PgColumnBuilder {
  static [entityKind] = "PgVectorBuilder";
  constructor(name, config) {
    super(name, "array", "PgVector");
    this.config.dimensions = config.dimensions;
  }
  /** @internal */
  build(table) {
    return new PgVector(
      table,
      this.config
    );
  }
};
var PgVector = class extends PgColumn {
  static [entityKind] = "PgVector";
  dimensions = this.config.dimensions;
  getSQLType() {
    return `vector(${this.dimensions})`;
  }
  mapToDriverValue(value) {
    return JSON.stringify(value);
  }
  mapFromDriverValue(value) {
    return value.slice(1, -1).split(",").map((v) => Number.parseFloat(v));
  }
};
function vector(a, b2) {
  const { name, config } = getColumnNameAndConfig(a, b2);
  return new PgVectorBuilder(name, config);
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/columns/all.js
function getPgColumnBuilders() {
  return {
    bigint,
    bigserial,
    boolean,
    char,
    cidr,
    customType,
    date,
    doublePrecision,
    inet,
    integer,
    interval,
    json,
    jsonb,
    line,
    macaddr,
    macaddr8,
    numeric,
    point,
    geometry,
    real,
    serial,
    smallint,
    smallserial,
    text,
    time,
    timestamp,
    uuid,
    varchar,
    bit,
    halfvec,
    sparsevec,
    vector
  };
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/table.js
var InlineForeignKeys = Symbol.for("drizzle:PgInlineForeignKeys");
var EnableRLS = Symbol.for("drizzle:EnableRLS");
var PgTable = class extends Table {
  static [entityKind] = "PgTable";
  /** @internal */
  static Symbol = Object.assign({}, Table.Symbol, {
    InlineForeignKeys,
    EnableRLS
  });
  /**@internal */
  [InlineForeignKeys] = [];
  /** @internal */
  [EnableRLS] = false;
  /** @internal */
  [Table.Symbol.ExtraConfigBuilder] = void 0;
  /** @internal */
  [Table.Symbol.ExtraConfigColumns] = {};
};
function pgTableWithSchema(name, columns, extraConfig, schema, baseName = name) {
  const rawTable = new PgTable(name, schema, baseName);
  const parsedColumns = typeof columns === "function" ? columns(getPgColumnBuilders()) : columns;
  const builtColumns = Object.fromEntries(
    Object.entries(parsedColumns).map(([name2, colBuilderBase]) => {
      const colBuilder = colBuilderBase;
      colBuilder.setName(name2);
      const column = colBuilder.build(rawTable);
      rawTable[InlineForeignKeys].push(...colBuilder.buildForeignKeys(column, rawTable));
      return [name2, column];
    })
  );
  const builtColumnsForExtraConfig = Object.fromEntries(
    Object.entries(parsedColumns).map(([name2, colBuilderBase]) => {
      const colBuilder = colBuilderBase;
      colBuilder.setName(name2);
      const column = colBuilder.buildExtraConfigColumn(rawTable);
      return [name2, column];
    })
  );
  const table = Object.assign(rawTable, builtColumns);
  table[Table.Symbol.Columns] = builtColumns;
  table[Table.Symbol.ExtraConfigColumns] = builtColumnsForExtraConfig;
  if (extraConfig) {
    table[PgTable.Symbol.ExtraConfigBuilder] = extraConfig;
  }
  return Object.assign(table, {
    enableRLS: () => {
      table[PgTable.Symbol.EnableRLS] = true;
      return table;
    }
  });
}
function pgTableCreator(customizeTableName) {
  return (name, columns, extraConfig) => {
    return pgTableWithSchema(customizeTableName(name), columns, extraConfig, void 0, name);
  };
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/primary-keys.js
var PrimaryKeyBuilder = class {
  static [entityKind] = "PgPrimaryKeyBuilder";
  /** @internal */
  columns;
  /** @internal */
  name;
  constructor(columns, name) {
    this.columns = columns;
    this.name = name;
  }
  /** @internal */
  build(table) {
    return new PrimaryKey(table, this.columns, this.name);
  }
};
var PrimaryKey = class {
  constructor(table, columns, name) {
    this.table = table;
    this.columns = columns;
    this.name = name;
  }
  static [entityKind] = "PgPrimaryKey";
  columns;
  name;
  getName() {
    return this.name ?? `${this.table[PgTable.Symbol.Name]}_${this.columns.map((column) => column.name).join("_")}_pk`;
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/sql/expressions/conditions.js
function bindIfParam(value, column) {
  if (isDriverValueEncoder(column) && !isSQLWrapper(value) && !is(value, Param) && !is(value, Placeholder) && !is(value, Column) && !is(value, Table) && !is(value, View)) {
    return new Param(value, column);
  }
  return value;
}
var eq = (left, right) => {
  return sql`${left} = ${bindIfParam(right, left)}`;
};
var ne = (left, right) => {
  return sql`${left} <> ${bindIfParam(right, left)}`;
};
function and(...unfilteredConditions) {
  const conditions = unfilteredConditions.filter(
    (c) => c !== void 0
  );
  if (conditions.length === 0) {
    return void 0;
  }
  if (conditions.length === 1) {
    return new SQL(conditions);
  }
  return new SQL([
    new StringChunk("("),
    sql.join(conditions, new StringChunk(" and ")),
    new StringChunk(")")
  ]);
}
function or(...unfilteredConditions) {
  const conditions = unfilteredConditions.filter(
    (c) => c !== void 0
  );
  if (conditions.length === 0) {
    return void 0;
  }
  if (conditions.length === 1) {
    return new SQL(conditions);
  }
  return new SQL([
    new StringChunk("("),
    sql.join(conditions, new StringChunk(" or ")),
    new StringChunk(")")
  ]);
}
function not(condition) {
  return sql`not ${condition}`;
}
var gt = (left, right) => {
  return sql`${left} > ${bindIfParam(right, left)}`;
};
var gte = (left, right) => {
  return sql`${left} >= ${bindIfParam(right, left)}`;
};
var lt = (left, right) => {
  return sql`${left} < ${bindIfParam(right, left)}`;
};
var lte = (left, right) => {
  return sql`${left} <= ${bindIfParam(right, left)}`;
};
function inArray(column, values2) {
  if (Array.isArray(values2)) {
    if (values2.length === 0) {
      return sql`false`;
    }
    return sql`${column} in ${values2.map((v) => bindIfParam(v, column))}`;
  }
  return sql`${column} in ${bindIfParam(values2, column)}`;
}
function notInArray(column, values2) {
  if (Array.isArray(values2)) {
    if (values2.length === 0) {
      return sql`true`;
    }
    return sql`${column} not in ${values2.map((v) => bindIfParam(v, column))}`;
  }
  return sql`${column} not in ${bindIfParam(values2, column)}`;
}
function isNull(value) {
  return sql`${value} is null`;
}
function isNotNull(value) {
  return sql`${value} is not null`;
}
function exists(subquery) {
  return sql`exists ${subquery}`;
}
function notExists(subquery) {
  return sql`not exists ${subquery}`;
}
function between(column, min, max) {
  return sql`${column} between ${bindIfParam(min, column)} and ${bindIfParam(
    max,
    column
  )}`;
}
function notBetween(column, min, max) {
  return sql`${column} not between ${bindIfParam(
    min,
    column
  )} and ${bindIfParam(max, column)}`;
}
function like(column, value) {
  return sql`${column} like ${value}`;
}
function notLike(column, value) {
  return sql`${column} not like ${value}`;
}
function ilike(column, value) {
  return sql`${column} ilike ${value}`;
}
function notIlike(column, value) {
  return sql`${column} not ilike ${value}`;
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/sql/expressions/select.js
function asc(column) {
  return sql`${column} asc`;
}
function desc(column) {
  return sql`${column} desc`;
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/relations.js
var Relation = class {
  constructor(sourceTable, referencedTable, relationName) {
    this.sourceTable = sourceTable;
    this.referencedTable = referencedTable;
    this.relationName = relationName;
    this.referencedTableName = referencedTable[Table.Symbol.Name];
  }
  static [entityKind] = "Relation";
  referencedTableName;
  fieldName;
};
var Relations = class {
  constructor(table, config) {
    this.table = table;
    this.config = config;
  }
  static [entityKind] = "Relations";
};
var One = class _One extends Relation {
  constructor(sourceTable, referencedTable, config, isNullable) {
    super(sourceTable, referencedTable, config?.relationName);
    this.config = config;
    this.isNullable = isNullable;
  }
  static [entityKind] = "One";
  withFieldName(fieldName) {
    const relation = new _One(
      this.sourceTable,
      this.referencedTable,
      this.config,
      this.isNullable
    );
    relation.fieldName = fieldName;
    return relation;
  }
};
var Many = class _Many extends Relation {
  constructor(sourceTable, referencedTable, config) {
    super(sourceTable, referencedTable, config?.relationName);
    this.config = config;
  }
  static [entityKind] = "Many";
  withFieldName(fieldName) {
    const relation = new _Many(
      this.sourceTable,
      this.referencedTable,
      this.config
    );
    relation.fieldName = fieldName;
    return relation;
  }
};
function getOperators() {
  return {
    and,
    between,
    eq,
    exists,
    gt,
    gte,
    ilike,
    inArray,
    isNull,
    isNotNull,
    like,
    lt,
    lte,
    ne,
    not,
    notBetween,
    notExists,
    notLike,
    notIlike,
    notInArray,
    or,
    sql
  };
}
function getOrderByOperators() {
  return {
    sql,
    asc,
    desc
  };
}
function extractTablesRelationalConfig(schema, configHelpers) {
  if (Object.keys(schema).length === 1 && "default" in schema && !is(schema["default"], Table)) {
    schema = schema["default"];
  }
  const tableNamesMap = {};
  const relationsBuffer = {};
  const tablesConfig = {};
  for (const [key, value] of Object.entries(schema)) {
    if (is(value, Table)) {
      const dbName = getTableUniqueName(value);
      const bufferedRelations = relationsBuffer[dbName];
      tableNamesMap[dbName] = key;
      tablesConfig[key] = {
        tsName: key,
        dbName: value[Table.Symbol.Name],
        schema: value[Table.Symbol.Schema],
        columns: value[Table.Symbol.Columns],
        relations: bufferedRelations?.relations ?? {},
        primaryKey: bufferedRelations?.primaryKey ?? []
      };
      for (const column of Object.values(
        value[Table.Symbol.Columns]
      )) {
        if (column.primary) {
          tablesConfig[key].primaryKey.push(column);
        }
      }
      const extraConfig = value[Table.Symbol.ExtraConfigBuilder]?.(value[Table.Symbol.ExtraConfigColumns]);
      if (extraConfig) {
        for (const configEntry of Object.values(extraConfig)) {
          if (is(configEntry, PrimaryKeyBuilder)) {
            tablesConfig[key].primaryKey.push(...configEntry.columns);
          }
        }
      }
    } else if (is(value, Relations)) {
      const dbName = getTableUniqueName(value.table);
      const tableName = tableNamesMap[dbName];
      const relations2 = value.config(
        configHelpers(value.table)
      );
      let primaryKey;
      for (const [relationName, relation] of Object.entries(relations2)) {
        if (tableName) {
          const tableConfig = tablesConfig[tableName];
          tableConfig.relations[relationName] = relation;
          if (primaryKey) {
            tableConfig.primaryKey.push(...primaryKey);
          }
        } else {
          if (!(dbName in relationsBuffer)) {
            relationsBuffer[dbName] = {
              relations: {},
              primaryKey
            };
          }
          relationsBuffer[dbName].relations[relationName] = relation;
        }
      }
    }
  }
  return { tables: tablesConfig, tableNamesMap };
}
function relations(table, relations2) {
  return new Relations(
    table,
    (helpers) => Object.fromEntries(
      Object.entries(relations2(helpers)).map(([key, value]) => [
        key,
        value.withFieldName(key)
      ])
    )
  );
}
function createOne(sourceTable) {
  return function one(table, config) {
    return new One(
      sourceTable,
      table,
      config,
      config?.fields.reduce((res, f) => res && f.notNull, true) ?? false
    );
  };
}
function createMany(sourceTable) {
  return function many(referencedTable, config) {
    return new Many(sourceTable, referencedTable, config);
  };
}
function normalizeRelation(schema, tableNamesMap, relation) {
  if (is(relation, One) && relation.config) {
    return {
      fields: relation.config.fields,
      references: relation.config.references
    };
  }
  const referencedTableTsName = tableNamesMap[getTableUniqueName(relation.referencedTable)];
  if (!referencedTableTsName) {
    throw new Error(
      `Table "${relation.referencedTable[Table.Symbol.Name]}" not found in schema`
    );
  }
  const referencedTableConfig = schema[referencedTableTsName];
  if (!referencedTableConfig) {
    throw new Error(`Table "${referencedTableTsName}" not found in schema`);
  }
  const sourceTable = relation.sourceTable;
  const sourceTableTsName = tableNamesMap[getTableUniqueName(sourceTable)];
  if (!sourceTableTsName) {
    throw new Error(
      `Table "${sourceTable[Table.Symbol.Name]}" not found in schema`
    );
  }
  const reverseRelations = [];
  for (const referencedTableRelation of Object.values(
    referencedTableConfig.relations
  )) {
    if (relation.relationName && relation !== referencedTableRelation && referencedTableRelation.relationName === relation.relationName || !relation.relationName && referencedTableRelation.referencedTable === relation.sourceTable) {
      reverseRelations.push(referencedTableRelation);
    }
  }
  if (reverseRelations.length > 1) {
    throw relation.relationName ? new Error(
      `There are multiple relations with name "${relation.relationName}" in table "${referencedTableTsName}"`
    ) : new Error(
      `There are multiple relations between "${referencedTableTsName}" and "${relation.sourceTable[Table.Symbol.Name]}". Please specify relation name`
    );
  }
  if (reverseRelations[0] && is(reverseRelations[0], One) && reverseRelations[0].config) {
    return {
      fields: reverseRelations[0].config.references,
      references: reverseRelations[0].config.fields
    };
  }
  throw new Error(
    `There is not enough information to infer relation "${sourceTableTsName}.${relation.fieldName}"`
  );
}
function createTableRelationsHelpers(sourceTable) {
  return {
    one: createOne(sourceTable),
    many: createMany(sourceTable)
  };
}
function mapRelationalRow(tablesConfig, tableConfig, row, buildQueryResultSelection, mapColumnValue = (value) => value) {
  const result = {};
  for (const [
    selectionItemIndex,
    selectionItem
  ] of buildQueryResultSelection.entries()) {
    if (selectionItem.isJson) {
      const relation = tableConfig.relations[selectionItem.tsKey];
      const rawSubRows = row[selectionItemIndex];
      const subRows = typeof rawSubRows === "string" ? JSON.parse(rawSubRows) : rawSubRows;
      result[selectionItem.tsKey] = is(relation, One) ? subRows && mapRelationalRow(
        tablesConfig,
        tablesConfig[selectionItem.relationTableTsKey],
        subRows,
        selectionItem.selection,
        mapColumnValue
      ) : subRows.map(
        (subRow) => mapRelationalRow(
          tablesConfig,
          tablesConfig[selectionItem.relationTableTsKey],
          subRow,
          selectionItem.selection,
          mapColumnValue
        )
      );
    } else {
      const value = mapColumnValue(row[selectionItemIndex]);
      const field = selectionItem.field;
      let decoder;
      if (is(field, Column)) {
        decoder = field;
      } else if (is(field, SQL)) {
        decoder = field.decoder;
      } else {
        decoder = field.sql.decoder;
      }
      result[selectionItem.tsKey] = value === null ? null : decoder.mapFromDriverValue(value);
    }
  }
  return result;
}

// ../../node_modules/.pnpm/postgres@3.4.7/node_modules/postgres/src/index.js
import os from "os";
import fs from "fs";

// ../../node_modules/.pnpm/postgres@3.4.7/node_modules/postgres/src/query.js
var originCache = /* @__PURE__ */ new Map();
var originStackCache = /* @__PURE__ */ new Map();
var originError = Symbol("OriginError");
var CLOSE = {};
var Query = class extends Promise {
  constructor(strings, args, handler, canceller, options = {}) {
    let resolve, reject;
    super((a, b2) => {
      resolve = a;
      reject = b2;
    });
    this.tagged = Array.isArray(strings.raw);
    this.strings = strings;
    this.args = args;
    this.handler = handler;
    this.canceller = canceller;
    this.options = options;
    this.state = null;
    this.statement = null;
    this.resolve = (x) => (this.active = false, resolve(x));
    this.reject = (x) => (this.active = false, reject(x));
    this.active = false;
    this.cancelled = null;
    this.executed = false;
    this.signature = "";
    this[originError] = this.handler.debug ? new Error() : this.tagged && cachedError(this.strings);
  }
  get origin() {
    return (this.handler.debug ? this[originError].stack : this.tagged && originStackCache.has(this.strings) ? originStackCache.get(this.strings) : originStackCache.set(this.strings, this[originError].stack).get(this.strings)) || "";
  }
  static get [Symbol.species]() {
    return Promise;
  }
  cancel() {
    return this.canceller && (this.canceller(this), this.canceller = null);
  }
  simple() {
    this.options.simple = true;
    this.options.prepare = false;
    return this;
  }
  async readable() {
    this.simple();
    this.streaming = true;
    return this;
  }
  async writable() {
    this.simple();
    this.streaming = true;
    return this;
  }
  cursor(rows = 1, fn) {
    this.options.simple = false;
    if (typeof rows === "function") {
      fn = rows;
      rows = 1;
    }
    this.cursorRows = rows;
    if (typeof fn === "function")
      return this.cursorFn = fn, this;
    let prev;
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          if (this.executed && !this.active)
            return { done: true };
          prev && prev();
          const promise = new Promise((resolve, reject) => {
            this.cursorFn = (value) => {
              resolve({ value, done: false });
              return new Promise((r) => prev = r);
            };
            this.resolve = () => (this.active = false, resolve({ done: true }));
            this.reject = (x) => (this.active = false, reject(x));
          });
          this.execute();
          return promise;
        },
        return() {
          prev && prev(CLOSE);
          return { done: true };
        }
      })
    };
  }
  describe() {
    this.options.simple = false;
    this.onlyDescribe = this.options.prepare = true;
    return this;
  }
  stream() {
    throw new Error(".stream has been renamed to .forEach");
  }
  forEach(fn) {
    this.forEachFn = fn;
    this.handle();
    return this;
  }
  raw() {
    this.isRaw = true;
    return this;
  }
  values() {
    this.isRaw = "values";
    return this;
  }
  async handle() {
    !this.executed && (this.executed = true) && await 1 && this.handler(this);
  }
  execute() {
    this.handle();
    return this;
  }
  then() {
    this.handle();
    return super.then.apply(this, arguments);
  }
  catch() {
    this.handle();
    return super.catch.apply(this, arguments);
  }
  finally() {
    this.handle();
    return super.finally.apply(this, arguments);
  }
};
function cachedError(xs) {
  if (originCache.has(xs))
    return originCache.get(xs);
  const x = Error.stackTraceLimit;
  Error.stackTraceLimit = 4;
  originCache.set(xs, new Error());
  Error.stackTraceLimit = x;
  return originCache.get(xs);
}

// ../../node_modules/.pnpm/postgres@3.4.7/node_modules/postgres/src/errors.js
var PostgresError = class extends Error {
  constructor(x) {
    super(x.message);
    this.name = this.constructor.name;
    Object.assign(this, x);
  }
};
var Errors = {
  connection,
  postgres,
  generic,
  notSupported
};
function connection(x, options, socket) {
  const { host, port } = socket || options;
  const error = Object.assign(
    new Error("write " + x + " " + (options.path || host + ":" + port)),
    {
      code: x,
      errno: x,
      address: options.path || host
    },
    options.path ? {} : { port }
  );
  Error.captureStackTrace(error, connection);
  return error;
}
function postgres(x) {
  const error = new PostgresError(x);
  Error.captureStackTrace(error, postgres);
  return error;
}
function generic(code, message) {
  const error = Object.assign(new Error(code + ": " + message), { code });
  Error.captureStackTrace(error, generic);
  return error;
}
function notSupported(x) {
  const error = Object.assign(
    new Error(x + " (B) is not supported"),
    {
      code: "MESSAGE_NOT_SUPPORTED",
      name: x
    }
  );
  Error.captureStackTrace(error, notSupported);
  return error;
}

// ../../node_modules/.pnpm/postgres@3.4.7/node_modules/postgres/src/types.js
var types = {
  string: {
    to: 25,
    from: null,
    // defaults to string
    serialize: (x) => "" + x
  },
  number: {
    to: 0,
    from: [21, 23, 26, 700, 701],
    serialize: (x) => "" + x,
    parse: (x) => +x
  },
  json: {
    to: 114,
    from: [114, 3802],
    serialize: (x) => JSON.stringify(x),
    parse: (x) => JSON.parse(x)
  },
  boolean: {
    to: 16,
    from: 16,
    serialize: (x) => x === true ? "t" : "f",
    parse: (x) => x === "t"
  },
  date: {
    to: 1184,
    from: [1082, 1114, 1184],
    serialize: (x) => (x instanceof Date ? x : new Date(x)).toISOString(),
    parse: (x) => new Date(x)
  },
  bytea: {
    to: 17,
    from: 17,
    serialize: (x) => "\\x" + Buffer.from(x).toString("hex"),
    parse: (x) => Buffer.from(x.slice(2), "hex")
  }
};
var NotTagged = class {
  then() {
    notTagged();
  }
  catch() {
    notTagged();
  }
  finally() {
    notTagged();
  }
};
var Identifier = class extends NotTagged {
  constructor(value) {
    super();
    this.value = escapeIdentifier(value);
  }
};
var Parameter = class extends NotTagged {
  constructor(value, type, array) {
    super();
    this.value = value;
    this.type = type;
    this.array = array;
  }
};
var Builder = class extends NotTagged {
  constructor(first, rest) {
    super();
    this.first = first;
    this.rest = rest;
  }
  build(before, parameters, types2, options) {
    const keyword = builders.map(([x, fn]) => ({ fn, i: before.search(x) })).sort((a, b2) => a.i - b2.i).pop();
    return keyword.i === -1 ? escapeIdentifiers(this.first, options) : keyword.fn(this.first, this.rest, parameters, types2, options);
  }
};
function handleValue(x, parameters, types2, options) {
  let value = x instanceof Parameter ? x.value : x;
  if (value === void 0) {
    x instanceof Parameter ? x.value = options.transform.undefined : value = x = options.transform.undefined;
    if (value === void 0)
      throw Errors.generic("UNDEFINED_VALUE", "Undefined values are not allowed");
  }
  return "$" + types2.push(
    x instanceof Parameter ? (parameters.push(x.value), x.array ? x.array[x.type || inferType(x.value)] || x.type || firstIsString(x.value) : x.type) : (parameters.push(x), inferType(x))
  );
}
var defaultHandlers = typeHandlers(types);
function stringify(q, string, value, parameters, types2, options) {
  for (let i = 1; i < q.strings.length; i++) {
    string += stringifyValue(string, value, parameters, types2, options) + q.strings[i];
    value = q.args[i];
  }
  return string;
}
function stringifyValue(string, value, parameters, types2, o) {
  return value instanceof Builder ? value.build(string, parameters, types2, o) : value instanceof Query ? fragment(value, parameters, types2, o) : value instanceof Identifier ? value.value : value && value[0] instanceof Query ? value.reduce((acc, x) => acc + " " + fragment(x, parameters, types2, o), "") : handleValue(value, parameters, types2, o);
}
function fragment(q, parameters, types2, options) {
  q.fragment = true;
  return stringify(q, q.strings[0], q.args[0], parameters, types2, options);
}
function valuesBuilder(first, parameters, types2, columns, options) {
  return first.map(
    (row) => "(" + columns.map(
      (column) => stringifyValue("values", row[column], parameters, types2, options)
    ).join(",") + ")"
  ).join(",");
}
function values(first, rest, parameters, types2, options) {
  const multi = Array.isArray(first[0]);
  const columns = rest.length ? rest.flat() : Object.keys(multi ? first[0] : first);
  return valuesBuilder(multi ? first : [first], parameters, types2, columns, options);
}
function select(first, rest, parameters, types2, options) {
  typeof first === "string" && (first = [first].concat(rest));
  if (Array.isArray(first))
    return escapeIdentifiers(first, options);
  let value;
  const columns = rest.length ? rest.flat() : Object.keys(first);
  return columns.map((x) => {
    value = first[x];
    return (value instanceof Query ? fragment(value, parameters, types2, options) : value instanceof Identifier ? value.value : handleValue(value, parameters, types2, options)) + " as " + escapeIdentifier(options.transform.column.to ? options.transform.column.to(x) : x);
  }).join(",");
}
var builders = Object.entries({
  values,
  in: (...xs) => {
    const x = values(...xs);
    return x === "()" ? "(null)" : x;
  },
  select,
  as: select,
  returning: select,
  "\\(": select,
  update(first, rest, parameters, types2, options) {
    return (rest.length ? rest.flat() : Object.keys(first)).map(
      (x) => escapeIdentifier(options.transform.column.to ? options.transform.column.to(x) : x) + "=" + stringifyValue("values", first[x], parameters, types2, options)
    );
  },
  insert(first, rest, parameters, types2, options) {
    const columns = rest.length ? rest.flat() : Object.keys(Array.isArray(first) ? first[0] : first);
    return "(" + escapeIdentifiers(columns, options) + ")values" + valuesBuilder(Array.isArray(first) ? first : [first], parameters, types2, columns, options);
  }
}).map(([x, fn]) => [new RegExp("((?:^|[\\s(])" + x + "(?:$|[\\s(]))(?![\\s\\S]*\\1)", "i"), fn]);
function notTagged() {
  throw Errors.generic("NOT_TAGGED_CALL", "Query not called as a tagged template literal");
}
var serializers = defaultHandlers.serializers;
var parsers = defaultHandlers.parsers;
function firstIsString(x) {
  if (Array.isArray(x))
    return firstIsString(x[0]);
  return typeof x === "string" ? 1009 : 0;
}
var mergeUserTypes = function(types2) {
  const user = typeHandlers(types2 || {});
  return {
    serializers: Object.assign({}, serializers, user.serializers),
    parsers: Object.assign({}, parsers, user.parsers)
  };
};
function typeHandlers(types2) {
  return Object.keys(types2).reduce((acc, k) => {
    types2[k].from && [].concat(types2[k].from).forEach((x) => acc.parsers[x] = types2[k].parse);
    if (types2[k].serialize) {
      acc.serializers[types2[k].to] = types2[k].serialize;
      types2[k].from && [].concat(types2[k].from).forEach((x) => acc.serializers[x] = types2[k].serialize);
    }
    return acc;
  }, { parsers: {}, serializers: {} });
}
function escapeIdentifiers(xs, { transform: { column } }) {
  return xs.map((x) => escapeIdentifier(column.to ? column.to(x) : x)).join(",");
}
var escapeIdentifier = function escape(str) {
  return '"' + str.replace(/"/g, '""').replace(/\./g, '"."') + '"';
};
var inferType = function inferType2(x) {
  return x instanceof Parameter ? x.type : x instanceof Date ? 1184 : x instanceof Uint8Array ? 17 : x === true || x === false ? 16 : typeof x === "bigint" ? 20 : Array.isArray(x) ? inferType2(x[0]) : 0;
};
var escapeBackslash = /\\/g;
var escapeQuote = /"/g;
function arrayEscape(x) {
  return x.replace(escapeBackslash, "\\\\").replace(escapeQuote, '\\"');
}
var arraySerializer = function arraySerializer2(xs, serializer, options, typarray) {
  if (Array.isArray(xs) === false)
    return xs;
  if (!xs.length)
    return "{}";
  const first = xs[0];
  const delimiter = typarray === 1020 ? ";" : ",";
  if (Array.isArray(first) && !first.type)
    return "{" + xs.map((x) => arraySerializer2(x, serializer, options, typarray)).join(delimiter) + "}";
  return "{" + xs.map((x) => {
    if (x === void 0) {
      x = options.transform.undefined;
      if (x === void 0)
        throw Errors.generic("UNDEFINED_VALUE", "Undefined values are not allowed");
    }
    return x === null ? "null" : '"' + arrayEscape(serializer ? serializer(x.type ? x.value : x) : "" + x) + '"';
  }).join(delimiter) + "}";
};
var arrayParserState = {
  i: 0,
  char: null,
  str: "",
  quoted: false,
  last: 0
};
var arrayParser = function arrayParser2(x, parser, typarray) {
  arrayParserState.i = arrayParserState.last = 0;
  return arrayParserLoop(arrayParserState, x, parser, typarray);
};
function arrayParserLoop(s, x, parser, typarray) {
  const xs = [];
  const delimiter = typarray === 1020 ? ";" : ",";
  for (; s.i < x.length; s.i++) {
    s.char = x[s.i];
    if (s.quoted) {
      if (s.char === "\\") {
        s.str += x[++s.i];
      } else if (s.char === '"') {
        xs.push(parser ? parser(s.str) : s.str);
        s.str = "";
        s.quoted = x[s.i + 1] === '"';
        s.last = s.i + 2;
      } else {
        s.str += s.char;
      }
    } else if (s.char === '"') {
      s.quoted = true;
    } else if (s.char === "{") {
      s.last = ++s.i;
      xs.push(arrayParserLoop(s, x, parser, typarray));
    } else if (s.char === "}") {
      s.quoted = false;
      s.last < s.i && xs.push(parser ? parser(x.slice(s.last, s.i)) : x.slice(s.last, s.i));
      s.last = s.i + 1;
      break;
    } else if (s.char === delimiter && s.p !== "}" && s.p !== '"') {
      xs.push(parser ? parser(x.slice(s.last, s.i)) : x.slice(s.last, s.i));
      s.last = s.i + 1;
    }
    s.p = s.char;
  }
  s.last < s.i && xs.push(parser ? parser(x.slice(s.last, s.i + 1)) : x.slice(s.last, s.i + 1));
  return xs;
}
var toCamel = (x) => {
  let str = x[0];
  for (let i = 1; i < x.length; i++)
    str += x[i] === "_" ? x[++i].toUpperCase() : x[i];
  return str;
};
var toPascal = (x) => {
  let str = x[0].toUpperCase();
  for (let i = 1; i < x.length; i++)
    str += x[i] === "_" ? x[++i].toUpperCase() : x[i];
  return str;
};
var toKebab = (x) => x.replace(/_/g, "-");
var fromCamel = (x) => x.replace(/([A-Z])/g, "_$1").toLowerCase();
var fromPascal = (x) => (x.slice(0, 1) + x.slice(1).replace(/([A-Z])/g, "_$1")).toLowerCase();
var fromKebab = (x) => x.replace(/-/g, "_");
function createJsonTransform(fn) {
  return function jsonTransform(x, column) {
    return typeof x === "object" && x !== null && (column.type === 114 || column.type === 3802) ? Array.isArray(x) ? x.map((x2) => jsonTransform(x2, column)) : Object.entries(x).reduce((acc, [k, v]) => Object.assign(acc, { [fn(k)]: jsonTransform(v, column) }), {}) : x;
  };
}
toCamel.column = { from: toCamel };
toCamel.value = { from: createJsonTransform(toCamel) };
fromCamel.column = { to: fromCamel };
var camel = { ...toCamel };
camel.column.to = fromCamel;
toPascal.column = { from: toPascal };
toPascal.value = { from: createJsonTransform(toPascal) };
fromPascal.column = { to: fromPascal };
var pascal = { ...toPascal };
pascal.column.to = fromPascal;
toKebab.column = { from: toKebab };
toKebab.value = { from: createJsonTransform(toKebab) };
fromKebab.column = { to: fromKebab };
var kebab = { ...toKebab };
kebab.column.to = fromKebab;

// ../../node_modules/.pnpm/postgres@3.4.7/node_modules/postgres/src/connection.js
import net from "net";
import tls from "tls";
import crypto2 from "crypto";
import Stream from "stream";
import { performance } from "perf_hooks";

// ../../node_modules/.pnpm/postgres@3.4.7/node_modules/postgres/src/result.js
var Result = class extends Array {
  constructor() {
    super();
    Object.defineProperties(this, {
      count: { value: null, writable: true },
      state: { value: null, writable: true },
      command: { value: null, writable: true },
      columns: { value: null, writable: true },
      statement: { value: null, writable: true }
    });
  }
  static get [Symbol.species]() {
    return Array;
  }
};

// ../../node_modules/.pnpm/postgres@3.4.7/node_modules/postgres/src/queue.js
var queue_default = Queue;
function Queue(initial = []) {
  let xs = initial.slice();
  let index2 = 0;
  return {
    get length() {
      return xs.length - index2;
    },
    remove: (x) => {
      const index3 = xs.indexOf(x);
      return index3 === -1 ? null : (xs.splice(index3, 1), x);
    },
    push: (x) => (xs.push(x), x),
    shift: () => {
      const out = xs[index2++];
      if (index2 === xs.length) {
        index2 = 0;
        xs = [];
      } else {
        xs[index2 - 1] = void 0;
      }
      return out;
    }
  };
}

// ../../node_modules/.pnpm/postgres@3.4.7/node_modules/postgres/src/bytes.js
var size = 256;
var buffer = Buffer.allocUnsafe(size);
var messages = "BCcDdEFfHPpQSX".split("").reduce((acc, x) => {
  const v = x.charCodeAt(0);
  acc[x] = () => {
    buffer[0] = v;
    b.i = 5;
    return b;
  };
  return acc;
}, {});
var b = Object.assign(reset, messages, {
  N: String.fromCharCode(0),
  i: 0,
  inc(x) {
    b.i += x;
    return b;
  },
  str(x) {
    const length = Buffer.byteLength(x);
    fit(length);
    b.i += buffer.write(x, b.i, length, "utf8");
    return b;
  },
  i16(x) {
    fit(2);
    buffer.writeUInt16BE(x, b.i);
    b.i += 2;
    return b;
  },
  i32(x, i) {
    if (i || i === 0) {
      buffer.writeUInt32BE(x, i);
      return b;
    }
    fit(4);
    buffer.writeUInt32BE(x, b.i);
    b.i += 4;
    return b;
  },
  z(x) {
    fit(x);
    buffer.fill(0, b.i, b.i + x);
    b.i += x;
    return b;
  },
  raw(x) {
    buffer = Buffer.concat([buffer.subarray(0, b.i), x]);
    b.i = buffer.length;
    return b;
  },
  end(at = 1) {
    buffer.writeUInt32BE(b.i - at, at);
    const out = buffer.subarray(0, b.i);
    b.i = 0;
    buffer = Buffer.allocUnsafe(size);
    return out;
  }
});
var bytes_default = b;
function fit(x) {
  if (buffer.length - b.i < x) {
    const prev = buffer, length = prev.length;
    buffer = Buffer.allocUnsafe(length + (length >> 1) + x);
    prev.copy(buffer);
  }
}
function reset() {
  b.i = 0;
  return b;
}

// ../../node_modules/.pnpm/postgres@3.4.7/node_modules/postgres/src/connection.js
var connection_default = Connection;
var uid = 1;
var Sync = bytes_default().S().end();
var Flush = bytes_default().H().end();
var SSLRequest = bytes_default().i32(8).i32(80877103).end(8);
var ExecuteUnnamed = Buffer.concat([bytes_default().E().str(bytes_default.N).i32(0).end(), Sync]);
var DescribeUnnamed = bytes_default().D().str("S").str(bytes_default.N).end();
var noop = () => {
};
var retryRoutines = /* @__PURE__ */ new Set([
  "FetchPreparedStatement",
  "RevalidateCachedQuery",
  "transformAssignedExpr"
]);
var errorFields = {
  83: "severity_local",
  // S
  86: "severity",
  // V
  67: "code",
  // C
  77: "message",
  // M
  68: "detail",
  // D
  72: "hint",
  // H
  80: "position",
  // P
  112: "internal_position",
  // p
  113: "internal_query",
  // q
  87: "where",
  // W
  115: "schema_name",
  // s
  116: "table_name",
  // t
  99: "column_name",
  // c
  100: "data type_name",
  // d
  110: "constraint_name",
  // n
  70: "file",
  // F
  76: "line",
  // L
  82: "routine"
  // R
};
function Connection(options, queues = {}, { onopen = noop, onend = noop, onclose = noop } = {}) {
  const {
    ssl,
    max,
    user,
    host,
    port,
    database,
    parsers: parsers2,
    transform,
    onnotice,
    onnotify,
    onparameter,
    max_pipeline,
    keep_alive,
    backoff: backoff2,
    target_session_attrs
  } = options;
  const sent = queue_default(), id = uid++, backend = { pid: null, secret: null }, idleTimer = timer(end, options.idle_timeout), lifeTimer = timer(end, options.max_lifetime), connectTimer = timer(connectTimedOut, options.connect_timeout);
  let socket = null, cancelMessage, result = new Result(), incoming = Buffer.alloc(0), needsTypes = options.fetch_types, backendParameters = {}, statements = {}, statementId = Math.random().toString(36).slice(2), statementCount = 1, closedDate = 0, remaining = 0, hostIndex = 0, retries = 0, length = 0, delay2 = 0, rows = 0, serverSignature = null, nextWriteTimer = null, terminated = false, incomings = null, results = null, initial = null, ending = null, stream = null, chunk = null, ended = null, nonce = null, query = null, final = null;
  const connection2 = {
    queue: queues.closed,
    idleTimer,
    connect(query2) {
      initial = query2;
      reconnect();
    },
    terminate,
    execute,
    cancel,
    end,
    count: 0,
    id
  };
  queues.closed && queues.closed.push(connection2);
  return connection2;
  async function createSocket() {
    let x;
    try {
      x = options.socket ? await Promise.resolve(options.socket(options)) : new net.Socket();
    } catch (e) {
      error(e);
      return;
    }
    x.on("error", error);
    x.on("close", closed);
    x.on("drain", drain);
    return x;
  }
  async function cancel({ pid, secret }, resolve, reject) {
    try {
      cancelMessage = bytes_default().i32(16).i32(80877102).i32(pid).i32(secret).end(16);
      await connect();
      socket.once("error", reject);
      socket.once("close", resolve);
    } catch (error2) {
      reject(error2);
    }
  }
  function execute(q) {
    if (terminated)
      return queryError(q, Errors.connection("CONNECTION_DESTROYED", options));
    if (q.cancelled)
      return;
    try {
      q.state = backend;
      query ? sent.push(q) : (query = q, query.active = true);
      build(q);
      return write(toBuffer(q)) && !q.describeFirst && !q.cursorFn && sent.length < max_pipeline && (!q.options.onexecute || q.options.onexecute(connection2));
    } catch (error2) {
      sent.length === 0 && write(Sync);
      errored(error2);
      return true;
    }
  }
  function toBuffer(q) {
    if (q.parameters.length >= 65534)
      throw Errors.generic("MAX_PARAMETERS_EXCEEDED", "Max number of parameters (65534) exceeded");
    return q.options.simple ? bytes_default().Q().str(q.statement.string + bytes_default.N).end() : q.describeFirst ? Buffer.concat([describe(q), Flush]) : q.prepare ? q.prepared ? prepared(q) : Buffer.concat([describe(q), prepared(q)]) : unnamed(q);
  }
  function describe(q) {
    return Buffer.concat([
      Parse(q.statement.string, q.parameters, q.statement.types, q.statement.name),
      Describe("S", q.statement.name)
    ]);
  }
  function prepared(q) {
    return Buffer.concat([
      Bind(q.parameters, q.statement.types, q.statement.name, q.cursorName),
      q.cursorFn ? Execute("", q.cursorRows) : ExecuteUnnamed
    ]);
  }
  function unnamed(q) {
    return Buffer.concat([
      Parse(q.statement.string, q.parameters, q.statement.types),
      DescribeUnnamed,
      prepared(q)
    ]);
  }
  function build(q) {
    const parameters = [], types2 = [];
    const string = stringify(q, q.strings[0], q.args[0], parameters, types2, options);
    !q.tagged && q.args.forEach((x) => handleValue(x, parameters, types2, options));
    q.prepare = options.prepare && ("prepare" in q.options ? q.options.prepare : true);
    q.string = string;
    q.signature = q.prepare && types2 + string;
    q.onlyDescribe && delete statements[q.signature];
    q.parameters = q.parameters || parameters;
    q.prepared = q.prepare && q.signature in statements;
    q.describeFirst = q.onlyDescribe || parameters.length && !q.prepared;
    q.statement = q.prepared ? statements[q.signature] : { string, types: types2, name: q.prepare ? statementId + statementCount++ : "" };
    typeof options.debug === "function" && options.debug(id, string, parameters, types2);
  }
  function write(x, fn) {
    chunk = chunk ? Buffer.concat([chunk, x]) : Buffer.from(x);
    if (fn || chunk.length >= 1024)
      return nextWrite(fn);
    nextWriteTimer === null && (nextWriteTimer = setImmediate(nextWrite));
    return true;
  }
  function nextWrite(fn) {
    const x = socket.write(chunk, fn);
    nextWriteTimer !== null && clearImmediate(nextWriteTimer);
    chunk = nextWriteTimer = null;
    return x;
  }
  function connectTimedOut() {
    errored(Errors.connection("CONNECT_TIMEOUT", options, socket));
    socket.destroy();
  }
  async function secure() {
    write(SSLRequest);
    const canSSL = await new Promise((r) => socket.once("data", (x) => r(x[0] === 83)));
    if (!canSSL && ssl === "prefer")
      return connected();
    socket.removeAllListeners();
    socket = tls.connect({
      socket,
      servername: net.isIP(socket.host) ? void 0 : socket.host,
      ...ssl === "require" || ssl === "allow" || ssl === "prefer" ? { rejectUnauthorized: false } : ssl === "verify-full" ? {} : typeof ssl === "object" ? ssl : {}
    });
    socket.on("secureConnect", connected);
    socket.on("error", error);
    socket.on("close", closed);
    socket.on("drain", drain);
  }
  function drain() {
    !query && onopen(connection2);
  }
  function data(x) {
    if (incomings) {
      incomings.push(x);
      remaining -= x.length;
      if (remaining > 0)
        return;
    }
    incoming = incomings ? Buffer.concat(incomings, length - remaining) : incoming.length === 0 ? x : Buffer.concat([incoming, x], incoming.length + x.length);
    while (incoming.length > 4) {
      length = incoming.readUInt32BE(1);
      if (length >= incoming.length) {
        remaining = length - incoming.length;
        incomings = [incoming];
        break;
      }
      try {
        handle(incoming.subarray(0, length + 1));
      } catch (e) {
        query && (query.cursorFn || query.describeFirst) && write(Sync);
        errored(e);
      }
      incoming = incoming.subarray(length + 1);
      remaining = 0;
      incomings = null;
    }
  }
  async function connect() {
    terminated = false;
    backendParameters = {};
    socket || (socket = await createSocket());
    if (!socket)
      return;
    connectTimer.start();
    if (options.socket)
      return ssl ? secure() : connected();
    socket.on("connect", ssl ? secure : connected);
    if (options.path)
      return socket.connect(options.path);
    socket.ssl = ssl;
    socket.connect(port[hostIndex], host[hostIndex]);
    socket.host = host[hostIndex];
    socket.port = port[hostIndex];
    hostIndex = (hostIndex + 1) % port.length;
  }
  function reconnect() {
    setTimeout(connect, closedDate ? closedDate + delay2 - performance.now() : 0);
  }
  function connected() {
    try {
      statements = {};
      needsTypes = options.fetch_types;
      statementId = Math.random().toString(36).slice(2);
      statementCount = 1;
      lifeTimer.start();
      socket.on("data", data);
      keep_alive && socket.setKeepAlive && socket.setKeepAlive(true, 1e3 * keep_alive);
      const s = StartupMessage();
      write(s);
    } catch (err) {
      error(err);
    }
  }
  function error(err) {
    if (connection2.queue === queues.connecting && options.host[retries + 1])
      return;
    errored(err);
    while (sent.length)
      queryError(sent.shift(), err);
  }
  function errored(err) {
    stream && (stream.destroy(err), stream = null);
    query && queryError(query, err);
    initial && (queryError(initial, err), initial = null);
  }
  function queryError(query2, err) {
    if (query2.reserve)
      return query2.reject(err);
    if (!err || typeof err !== "object")
      err = new Error(err);
    "query" in err || "parameters" in err || Object.defineProperties(err, {
      stack: { value: err.stack + query2.origin.replace(/.*\n/, "\n"), enumerable: options.debug },
      query: { value: query2.string, enumerable: options.debug },
      parameters: { value: query2.parameters, enumerable: options.debug },
      args: { value: query2.args, enumerable: options.debug },
      types: { value: query2.statement && query2.statement.types, enumerable: options.debug }
    });
    query2.reject(err);
  }
  function end() {
    return ending || (!connection2.reserved && onend(connection2), !connection2.reserved && !initial && !query && sent.length === 0 ? (terminate(), new Promise((r) => socket && socket.readyState !== "closed" ? socket.once("close", r) : r())) : ending = new Promise((r) => ended = r));
  }
  function terminate() {
    terminated = true;
    if (stream || query || initial || sent.length)
      error(Errors.connection("CONNECTION_DESTROYED", options));
    clearImmediate(nextWriteTimer);
    if (socket) {
      socket.removeListener("data", data);
      socket.removeListener("connect", connected);
      socket.readyState === "open" && socket.end(bytes_default().X().end());
    }
    ended && (ended(), ending = ended = null);
  }
  async function closed(hadError) {
    incoming = Buffer.alloc(0);
    remaining = 0;
    incomings = null;
    clearImmediate(nextWriteTimer);
    socket.removeListener("data", data);
    socket.removeListener("connect", connected);
    idleTimer.cancel();
    lifeTimer.cancel();
    connectTimer.cancel();
    socket.removeAllListeners();
    socket = null;
    if (initial)
      return reconnect();
    !hadError && (query || sent.length) && error(Errors.connection("CONNECTION_CLOSED", options, socket));
    closedDate = performance.now();
    hadError && options.shared.retries++;
    delay2 = (typeof backoff2 === "function" ? backoff2(options.shared.retries) : backoff2) * 1e3;
    onclose(connection2, Errors.connection("CONNECTION_CLOSED", options, socket));
  }
  function handle(xs, x = xs[0]) {
    (x === 68 ? DataRow : (
      // D
      x === 100 ? CopyData : (
        // d
        x === 65 ? NotificationResponse : (
          // A
          x === 83 ? ParameterStatus : (
            // S
            x === 90 ? ReadyForQuery : (
              // Z
              x === 67 ? CommandComplete : (
                // C
                x === 50 ? BindComplete : (
                  // 2
                  x === 49 ? ParseComplete : (
                    // 1
                    x === 116 ? ParameterDescription : (
                      // t
                      x === 84 ? RowDescription : (
                        // T
                        x === 82 ? Authentication : (
                          // R
                          x === 110 ? NoData : (
                            // n
                            x === 75 ? BackendKeyData : (
                              // K
                              x === 69 ? ErrorResponse : (
                                // E
                                x === 115 ? PortalSuspended : (
                                  // s
                                  x === 51 ? CloseComplete : (
                                    // 3
                                    x === 71 ? CopyInResponse : (
                                      // G
                                      x === 78 ? NoticeResponse : (
                                        // N
                                        x === 72 ? CopyOutResponse : (
                                          // H
                                          x === 99 ? CopyDone : (
                                            // c
                                            x === 73 ? EmptyQueryResponse : (
                                              // I
                                              x === 86 ? FunctionCallResponse : (
                                                // V
                                                x === 118 ? NegotiateProtocolVersion : (
                                                  // v
                                                  x === 87 ? CopyBothResponse : (
                                                    // W
                                                    /* c8 ignore next */
                                                    UnknownMessage
                                                  )
                                                )
                                              )
                                            )
                                          )
                                        )
                                      )
                                    )
                                  )
                                )
                              )
                            )
                          )
                        )
                      )
                    )
                  )
                )
              )
            )
          )
        )
      )
    ))(xs);
  }
  function DataRow(x) {
    let index2 = 7;
    let length2;
    let column;
    let value;
    const row = query.isRaw ? new Array(query.statement.columns.length) : {};
    for (let i = 0; i < query.statement.columns.length; i++) {
      column = query.statement.columns[i];
      length2 = x.readInt32BE(index2);
      index2 += 4;
      value = length2 === -1 ? null : query.isRaw === true ? x.subarray(index2, index2 += length2) : column.parser === void 0 ? x.toString("utf8", index2, index2 += length2) : column.parser.array === true ? column.parser(x.toString("utf8", index2 + 1, index2 += length2)) : column.parser(x.toString("utf8", index2, index2 += length2));
      query.isRaw ? row[i] = query.isRaw === true ? value : transform.value.from ? transform.value.from(value, column) : value : row[column.name] = transform.value.from ? transform.value.from(value, column) : value;
    }
    query.forEachFn ? query.forEachFn(transform.row.from ? transform.row.from(row) : row, result) : result[rows++] = transform.row.from ? transform.row.from(row) : row;
  }
  function ParameterStatus(x) {
    const [k, v] = x.toString("utf8", 5, x.length - 1).split(bytes_default.N);
    backendParameters[k] = v;
    if (options.parameters[k] !== v) {
      options.parameters[k] = v;
      onparameter && onparameter(k, v);
    }
  }
  function ReadyForQuery(x) {
    query && query.options.simple && query.resolve(results || result);
    query = results = null;
    result = new Result();
    connectTimer.cancel();
    if (initial) {
      if (target_session_attrs) {
        if (!backendParameters.in_hot_standby || !backendParameters.default_transaction_read_only)
          return fetchState();
        else if (tryNext(target_session_attrs, backendParameters))
          return terminate();
      }
      if (needsTypes) {
        initial.reserve && (initial = null);
        return fetchArrayTypes();
      }
      initial && !initial.reserve && execute(initial);
      options.shared.retries = retries = 0;
      initial = null;
      return;
    }
    while (sent.length && (query = sent.shift()) && (query.active = true, query.cancelled))
      Connection(options).cancel(query.state, query.cancelled.resolve, query.cancelled.reject);
    if (query)
      return;
    connection2.reserved ? !connection2.reserved.release && x[5] === 73 ? ending ? terminate() : (connection2.reserved = null, onopen(connection2)) : connection2.reserved() : ending ? terminate() : onopen(connection2);
  }
  function CommandComplete(x) {
    rows = 0;
    for (let i = x.length - 1; i > 0; i--) {
      if (x[i] === 32 && x[i + 1] < 58 && result.count === null)
        result.count = +x.toString("utf8", i + 1, x.length - 1);
      if (x[i - 1] >= 65) {
        result.command = x.toString("utf8", 5, i);
        result.state = backend;
        break;
      }
    }
    final && (final(), final = null);
    if (result.command === "BEGIN" && max !== 1 && !connection2.reserved)
      return errored(Errors.generic("UNSAFE_TRANSACTION", "Only use sql.begin, sql.reserved or max: 1"));
    if (query.options.simple)
      return BindComplete();
    if (query.cursorFn) {
      result.count && query.cursorFn(result);
      write(Sync);
    }
    query.resolve(result);
  }
  function ParseComplete() {
    query.parsing = false;
  }
  function BindComplete() {
    !result.statement && (result.statement = query.statement);
    result.columns = query.statement.columns;
  }
  function ParameterDescription(x) {
    const length2 = x.readUInt16BE(5);
    for (let i = 0; i < length2; ++i)
      !query.statement.types[i] && (query.statement.types[i] = x.readUInt32BE(7 + i * 4));
    query.prepare && (statements[query.signature] = query.statement);
    query.describeFirst && !query.onlyDescribe && (write(prepared(query)), query.describeFirst = false);
  }
  function RowDescription(x) {
    if (result.command) {
      results = results || [result];
      results.push(result = new Result());
      result.count = null;
      query.statement.columns = null;
    }
    const length2 = x.readUInt16BE(5);
    let index2 = 7;
    let start;
    query.statement.columns = Array(length2);
    for (let i = 0; i < length2; ++i) {
      start = index2;
      while (x[index2++] !== 0) ;
      const table = x.readUInt32BE(index2);
      const number = x.readUInt16BE(index2 + 4);
      const type = x.readUInt32BE(index2 + 6);
      query.statement.columns[i] = {
        name: transform.column.from ? transform.column.from(x.toString("utf8", start, index2 - 1)) : x.toString("utf8", start, index2 - 1),
        parser: parsers2[type],
        table,
        number,
        type
      };
      index2 += 18;
    }
    result.statement = query.statement;
    if (query.onlyDescribe)
      return query.resolve(query.statement), write(Sync);
  }
  async function Authentication(x, type = x.readUInt32BE(5)) {
    (type === 3 ? AuthenticationCleartextPassword : type === 5 ? AuthenticationMD5Password : type === 10 ? SASL : type === 11 ? SASLContinue : type === 12 ? SASLFinal : type !== 0 ? UnknownAuth : noop)(x, type);
  }
  async function AuthenticationCleartextPassword() {
    const payload = await Pass();
    write(
      bytes_default().p().str(payload).z(1).end()
    );
  }
  async function AuthenticationMD5Password(x) {
    const payload = "md5" + await md5(
      Buffer.concat([
        Buffer.from(await md5(await Pass() + user)),
        x.subarray(9)
      ])
    );
    write(
      bytes_default().p().str(payload).z(1).end()
    );
  }
  async function SASL() {
    nonce = (await crypto2.randomBytes(18)).toString("base64");
    bytes_default().p().str("SCRAM-SHA-256" + bytes_default.N);
    const i = bytes_default.i;
    write(bytes_default.inc(4).str("n,,n=*,r=" + nonce).i32(bytes_default.i - i - 4, i).end());
  }
  async function SASLContinue(x) {
    const res = x.toString("utf8", 9).split(",").reduce((acc, x2) => (acc[x2[0]] = x2.slice(2), acc), {});
    const saltedPassword = await crypto2.pbkdf2Sync(
      await Pass(),
      Buffer.from(res.s, "base64"),
      parseInt(res.i),
      32,
      "sha256"
    );
    const clientKey = await hmac(saltedPassword, "Client Key");
    const auth = "n=*,r=" + nonce + ",r=" + res.r + ",s=" + res.s + ",i=" + res.i + ",c=biws,r=" + res.r;
    serverSignature = (await hmac(await hmac(saltedPassword, "Server Key"), auth)).toString("base64");
    const payload = "c=biws,r=" + res.r + ",p=" + xor(
      clientKey,
      Buffer.from(await hmac(await sha256(clientKey), auth))
    ).toString("base64");
    write(
      bytes_default().p().str(payload).end()
    );
  }
  function SASLFinal(x) {
    if (x.toString("utf8", 9).split(bytes_default.N, 1)[0].slice(2) === serverSignature)
      return;
    errored(Errors.generic("SASL_SIGNATURE_MISMATCH", "The server did not return the correct signature"));
    socket.destroy();
  }
  function Pass() {
    return Promise.resolve(
      typeof options.pass === "function" ? options.pass() : options.pass
    );
  }
  function NoData() {
    result.statement = query.statement;
    result.statement.columns = [];
    if (query.onlyDescribe)
      return query.resolve(query.statement), write(Sync);
  }
  function BackendKeyData(x) {
    backend.pid = x.readUInt32BE(5);
    backend.secret = x.readUInt32BE(9);
  }
  async function fetchArrayTypes() {
    needsTypes = false;
    const types2 = await new Query([`
      select b.oid, b.typarray
      from pg_catalog.pg_type a
      left join pg_catalog.pg_type b on b.oid = a.typelem
      where a.typcategory = 'A'
      group by b.oid, b.typarray
      order by b.oid
    `], [], execute);
    types2.forEach(({ oid, typarray }) => addArrayType(oid, typarray));
  }
  function addArrayType(oid, typarray) {
    if (!!options.parsers[typarray] && !!options.serializers[typarray]) return;
    const parser = options.parsers[oid];
    options.shared.typeArrayMap[oid] = typarray;
    options.parsers[typarray] = (xs) => arrayParser(xs, parser, typarray);
    options.parsers[typarray].array = true;
    options.serializers[typarray] = (xs) => arraySerializer(xs, options.serializers[oid], options, typarray);
  }
  function tryNext(x, xs) {
    return x === "read-write" && xs.default_transaction_read_only === "on" || x === "read-only" && xs.default_transaction_read_only === "off" || x === "primary" && xs.in_hot_standby === "on" || x === "standby" && xs.in_hot_standby === "off" || x === "prefer-standby" && xs.in_hot_standby === "off" && options.host[retries];
  }
  function fetchState() {
    const query2 = new Query([`
      show transaction_read_only;
      select pg_catalog.pg_is_in_recovery()
    `], [], execute, null, { simple: true });
    query2.resolve = ([[a], [b2]]) => {
      backendParameters.default_transaction_read_only = a.transaction_read_only;
      backendParameters.in_hot_standby = b2.pg_is_in_recovery ? "on" : "off";
    };
    query2.execute();
  }
  function ErrorResponse(x) {
    query && (query.cursorFn || query.describeFirst) && write(Sync);
    const error2 = Errors.postgres(parseError(x));
    query && query.retried ? errored(query.retried) : query && query.prepared && retryRoutines.has(error2.routine) ? retry(query, error2) : errored(error2);
  }
  function retry(q, error2) {
    delete statements[q.signature];
    q.retried = error2;
    execute(q);
  }
  function NotificationResponse(x) {
    if (!onnotify)
      return;
    let index2 = 9;
    while (x[index2++] !== 0) ;
    onnotify(
      x.toString("utf8", 9, index2 - 1),
      x.toString("utf8", index2, x.length - 1)
    );
  }
  async function PortalSuspended() {
    try {
      const x = await Promise.resolve(query.cursorFn(result));
      rows = 0;
      x === CLOSE ? write(Close(query.portal)) : (result = new Result(), write(Execute("", query.cursorRows)));
    } catch (err) {
      write(Sync);
      query.reject(err);
    }
  }
  function CloseComplete() {
    result.count && query.cursorFn(result);
    query.resolve(result);
  }
  function CopyInResponse() {
    stream = new Stream.Writable({
      autoDestroy: true,
      write(chunk2, encoding, callback) {
        socket.write(bytes_default().d().raw(chunk2).end(), callback);
      },
      destroy(error2, callback) {
        callback(error2);
        socket.write(bytes_default().f().str(error2 + bytes_default.N).end());
        stream = null;
      },
      final(callback) {
        socket.write(bytes_default().c().end());
        final = callback;
      }
    });
    query.resolve(stream);
  }
  function CopyOutResponse() {
    stream = new Stream.Readable({
      read() {
        socket.resume();
      }
    });
    query.resolve(stream);
  }
  function CopyBothResponse() {
    stream = new Stream.Duplex({
      autoDestroy: true,
      read() {
        socket.resume();
      },
      /* c8 ignore next 11 */
      write(chunk2, encoding, callback) {
        socket.write(bytes_default().d().raw(chunk2).end(), callback);
      },
      destroy(error2, callback) {
        callback(error2);
        socket.write(bytes_default().f().str(error2 + bytes_default.N).end());
        stream = null;
      },
      final(callback) {
        socket.write(bytes_default().c().end());
        final = callback;
      }
    });
    query.resolve(stream);
  }
  function CopyData(x) {
    stream && (stream.push(x.subarray(5)) || socket.pause());
  }
  function CopyDone() {
    stream && stream.push(null);
    stream = null;
  }
  function NoticeResponse(x) {
    onnotice ? onnotice(parseError(x)) : console.log(parseError(x));
  }
  function EmptyQueryResponse() {
  }
  function FunctionCallResponse() {
    errored(Errors.notSupported("FunctionCallResponse"));
  }
  function NegotiateProtocolVersion() {
    errored(Errors.notSupported("NegotiateProtocolVersion"));
  }
  function UnknownMessage(x) {
    console.error("Postgres.js : Unknown Message:", x[0]);
  }
  function UnknownAuth(x, type) {
    console.error("Postgres.js : Unknown Auth:", type);
  }
  function Bind(parameters, types2, statement = "", portal = "") {
    let prev, type;
    bytes_default().B().str(portal + bytes_default.N).str(statement + bytes_default.N).i16(0).i16(parameters.length);
    parameters.forEach((x, i) => {
      if (x === null)
        return bytes_default.i32(4294967295);
      type = types2[i];
      parameters[i] = x = type in options.serializers ? options.serializers[type](x) : "" + x;
      prev = bytes_default.i;
      bytes_default.inc(4).str(x).i32(bytes_default.i - prev - 4, prev);
    });
    bytes_default.i16(0);
    return bytes_default.end();
  }
  function Parse(str, parameters, types2, name = "") {
    bytes_default().P().str(name + bytes_default.N).str(str + bytes_default.N).i16(parameters.length);
    parameters.forEach((x, i) => bytes_default.i32(types2[i] || 0));
    return bytes_default.end();
  }
  function Describe(x, name = "") {
    return bytes_default().D().str(x).str(name + bytes_default.N).end();
  }
  function Execute(portal = "", rows2 = 0) {
    return Buffer.concat([
      bytes_default().E().str(portal + bytes_default.N).i32(rows2).end(),
      Flush
    ]);
  }
  function Close(portal = "") {
    return Buffer.concat([
      bytes_default().C().str("P").str(portal + bytes_default.N).end(),
      bytes_default().S().end()
    ]);
  }
  function StartupMessage() {
    return cancelMessage || bytes_default().inc(4).i16(3).z(2).str(
      Object.entries(Object.assign(
        {
          user,
          database,
          client_encoding: "UTF8"
        },
        options.connection
      )).filter(([, v]) => v).map(([k, v]) => k + bytes_default.N + v).join(bytes_default.N)
    ).z(2).end(0);
  }
}
function parseError(x) {
  const error = {};
  let start = 5;
  for (let i = 5; i < x.length - 1; i++) {
    if (x[i] === 0) {
      error[errorFields[x[start]]] = x.toString("utf8", start + 1, i);
      start = i + 1;
    }
  }
  return error;
}
function md5(x) {
  return crypto2.createHash("md5").update(x).digest("hex");
}
function hmac(key, x) {
  return crypto2.createHmac("sha256", key).update(x).digest();
}
function sha256(x) {
  return crypto2.createHash("sha256").update(x).digest();
}
function xor(a, b2) {
  const length = Math.max(a.length, b2.length);
  const buffer2 = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i++)
    buffer2[i] = a[i] ^ b2[i];
  return buffer2;
}
function timer(fn, seconds) {
  seconds = typeof seconds === "function" ? seconds() : seconds;
  if (!seconds)
    return { cancel: noop, start: noop };
  let timer2;
  return {
    cancel() {
      timer2 && (clearTimeout(timer2), timer2 = null);
    },
    start() {
      timer2 && clearTimeout(timer2);
      timer2 = setTimeout(done, seconds * 1e3, arguments);
    }
  };
  function done(args) {
    fn.apply(null, args);
    timer2 = null;
  }
}

// ../../node_modules/.pnpm/postgres@3.4.7/node_modules/postgres/src/subscribe.js
var noop2 = () => {
};
function Subscribe(postgres2, options) {
  const subscribers = /* @__PURE__ */ new Map(), slot = "postgresjs_" + Math.random().toString(36).slice(2), state = {};
  let connection2, stream, ended = false;
  const sql2 = subscribe.sql = postgres2({
    ...options,
    transform: { column: {}, value: {}, row: {} },
    max: 1,
    fetch_types: false,
    idle_timeout: null,
    max_lifetime: null,
    connection: {
      ...options.connection,
      replication: "database"
    },
    onclose: async function() {
      if (ended)
        return;
      stream = null;
      state.pid = state.secret = void 0;
      connected(await init(sql2, slot, options.publications));
      subscribers.forEach((event) => event.forEach(({ onsubscribe }) => onsubscribe()));
    },
    no_subscribe: true
  });
  const end = sql2.end, close = sql2.close;
  sql2.end = async () => {
    ended = true;
    stream && await new Promise((r) => (stream.once("close", r), stream.end()));
    return end();
  };
  sql2.close = async () => {
    stream && await new Promise((r) => (stream.once("close", r), stream.end()));
    return close();
  };
  return subscribe;
  async function subscribe(event, fn, onsubscribe = noop2, onerror = noop2) {
    event = parseEvent(event);
    if (!connection2)
      connection2 = init(sql2, slot, options.publications);
    const subscriber = { fn, onsubscribe };
    const fns = subscribers.has(event) ? subscribers.get(event).add(subscriber) : subscribers.set(event, /* @__PURE__ */ new Set([subscriber])).get(event);
    const unsubscribe = () => {
      fns.delete(subscriber);
      fns.size === 0 && subscribers.delete(event);
    };
    return connection2.then((x) => {
      connected(x);
      onsubscribe();
      stream && stream.on("error", onerror);
      return { unsubscribe, state, sql: sql2 };
    });
  }
  function connected(x) {
    stream = x.stream;
    state.pid = x.state.pid;
    state.secret = x.state.secret;
  }
  async function init(sql3, slot2, publications) {
    if (!publications)
      throw new Error("Missing publication names");
    const xs = await sql3.unsafe(
      `CREATE_REPLICATION_SLOT ${slot2} TEMPORARY LOGICAL pgoutput NOEXPORT_SNAPSHOT`
    );
    const [x] = xs;
    const stream2 = await sql3.unsafe(
      `START_REPLICATION SLOT ${slot2} LOGICAL ${x.consistent_point} (proto_version '1', publication_names '${publications}')`
    ).writable();
    const state2 = {
      lsn: Buffer.concat(x.consistent_point.split("/").map((x2) => Buffer.from(("00000000" + x2).slice(-8), "hex")))
    };
    stream2.on("data", data);
    stream2.on("error", error);
    stream2.on("close", sql3.close);
    return { stream: stream2, state: xs.state };
    function error(e) {
      console.error("Unexpected error during logical streaming - reconnecting", e);
    }
    function data(x2) {
      if (x2[0] === 119) {
        parse(x2.subarray(25), state2, sql3.options.parsers, handle, options.transform);
      } else if (x2[0] === 107 && x2[17]) {
        state2.lsn = x2.subarray(1, 9);
        pong();
      }
    }
    function handle(a, b2) {
      const path = b2.relation.schema + "." + b2.relation.table;
      call("*", a, b2);
      call("*:" + path, a, b2);
      b2.relation.keys.length && call("*:" + path + "=" + b2.relation.keys.map((x2) => a[x2.name]), a, b2);
      call(b2.command, a, b2);
      call(b2.command + ":" + path, a, b2);
      b2.relation.keys.length && call(b2.command + ":" + path + "=" + b2.relation.keys.map((x2) => a[x2.name]), a, b2);
    }
    function pong() {
      const x2 = Buffer.alloc(34);
      x2[0] = "r".charCodeAt(0);
      x2.fill(state2.lsn, 1);
      x2.writeBigInt64BE(BigInt(Date.now() - Date.UTC(2e3, 0, 1)) * BigInt(1e3), 25);
      stream2.write(x2);
    }
  }
  function call(x, a, b2) {
    subscribers.has(x) && subscribers.get(x).forEach(({ fn }) => fn(a, b2, x));
  }
}
function Time(x) {
  return new Date(Date.UTC(2e3, 0, 1) + Number(x / BigInt(1e3)));
}
function parse(x, state, parsers2, handle, transform) {
  const char2 = (acc, [k, v]) => (acc[k.charCodeAt(0)] = v, acc);
  Object.entries({
    R: (x2) => {
      let i = 1;
      const r = state[x2.readUInt32BE(i)] = {
        schema: x2.toString("utf8", i += 4, i = x2.indexOf(0, i)) || "pg_catalog",
        table: x2.toString("utf8", i + 1, i = x2.indexOf(0, i + 1)),
        columns: Array(x2.readUInt16BE(i += 2)),
        keys: []
      };
      i += 2;
      let columnIndex = 0, column;
      while (i < x2.length) {
        column = r.columns[columnIndex++] = {
          key: x2[i++],
          name: transform.column.from ? transform.column.from(x2.toString("utf8", i, i = x2.indexOf(0, i))) : x2.toString("utf8", i, i = x2.indexOf(0, i)),
          type: x2.readUInt32BE(i += 1),
          parser: parsers2[x2.readUInt32BE(i)],
          atttypmod: x2.readUInt32BE(i += 4)
        };
        column.key && r.keys.push(column);
        i += 4;
      }
    },
    Y: () => {
    },
    // Type
    O: () => {
    },
    // Origin
    B: (x2) => {
      state.date = Time(x2.readBigInt64BE(9));
      state.lsn = x2.subarray(1, 9);
    },
    I: (x2) => {
      let i = 1;
      const relation = state[x2.readUInt32BE(i)];
      const { row } = tuples(x2, relation.columns, i += 7, transform);
      handle(row, {
        command: "insert",
        relation
      });
    },
    D: (x2) => {
      let i = 1;
      const relation = state[x2.readUInt32BE(i)];
      i += 4;
      const key = x2[i] === 75;
      handle(
        key || x2[i] === 79 ? tuples(x2, relation.columns, i += 3, transform).row : null,
        {
          command: "delete",
          relation,
          key
        }
      );
    },
    U: (x2) => {
      let i = 1;
      const relation = state[x2.readUInt32BE(i)];
      i += 4;
      const key = x2[i] === 75;
      const xs = key || x2[i] === 79 ? tuples(x2, relation.columns, i += 3, transform) : null;
      xs && (i = xs.i);
      const { row } = tuples(x2, relation.columns, i + 3, transform);
      handle(row, {
        command: "update",
        relation,
        key,
        old: xs && xs.row
      });
    },
    T: () => {
    },
    // Truncate,
    C: () => {
    }
    // Commit
  }).reduce(char2, {})[x[0]](x);
}
function tuples(x, columns, xi, transform) {
  let type, column, value;
  const row = transform.raw ? new Array(columns.length) : {};
  for (let i = 0; i < columns.length; i++) {
    type = x[xi++];
    column = columns[i];
    value = type === 110 ? null : type === 117 ? void 0 : column.parser === void 0 ? x.toString("utf8", xi + 4, xi += 4 + x.readUInt32BE(xi)) : column.parser.array === true ? column.parser(x.toString("utf8", xi + 5, xi += 4 + x.readUInt32BE(xi))) : column.parser(x.toString("utf8", xi + 4, xi += 4 + x.readUInt32BE(xi)));
    transform.raw ? row[i] = transform.raw === true ? value : transform.value.from ? transform.value.from(value, column) : value : row[column.name] = transform.value.from ? transform.value.from(value, column) : value;
  }
  return { i: xi, row: transform.row.from ? transform.row.from(row) : row };
}
function parseEvent(x) {
  const xs = x.match(/^(\*|insert|update|delete)?:?([^.]+?\.?[^=]+)?=?(.+)?/i) || [];
  if (!xs)
    throw new Error("Malformed subscribe pattern: " + x);
  const [, command, path, key] = xs;
  return (command || "*") + (path ? ":" + (path.indexOf(".") === -1 ? "public." + path : path) : "") + (key ? "=" + key : "");
}

// ../../node_modules/.pnpm/postgres@3.4.7/node_modules/postgres/src/large.js
import Stream2 from "stream";
function largeObject(sql2, oid, mode = 131072 | 262144) {
  return new Promise(async (resolve, reject) => {
    await sql2.begin(async (sql3) => {
      let finish;
      !oid && ([{ oid }] = await sql3`select lo_creat(-1) as oid`);
      const [{ fd }] = await sql3`select lo_open(${oid}, ${mode}) as fd`;
      const lo = {
        writable,
        readable,
        close: () => sql3`select lo_close(${fd})`.then(finish),
        tell: () => sql3`select lo_tell64(${fd})`,
        read: (x) => sql3`select loread(${fd}, ${x}) as data`,
        write: (x) => sql3`select lowrite(${fd}, ${x})`,
        truncate: (x) => sql3`select lo_truncate64(${fd}, ${x})`,
        seek: (x, whence = 0) => sql3`select lo_lseek64(${fd}, ${x}, ${whence})`,
        size: () => sql3`
          select
            lo_lseek64(${fd}, location, 0) as position,
            seek.size
          from (
            select
              lo_lseek64($1, 0, 2) as size,
              tell.location
            from (select lo_tell64($1) as location) tell
          ) seek
        `
      };
      resolve(lo);
      return new Promise(async (r) => finish = r);
      async function readable({
        highWaterMark = 2048 * 8,
        start = 0,
        end = Infinity
      } = {}) {
        let max = end - start;
        start && await lo.seek(start);
        return new Stream2.Readable({
          highWaterMark,
          async read(size2) {
            const l = size2 > max ? size2 - max : size2;
            max -= size2;
            const [{ data }] = await lo.read(l);
            this.push(data);
            if (data.length < size2)
              this.push(null);
          }
        });
      }
      async function writable({
        highWaterMark = 2048 * 8,
        start = 0
      } = {}) {
        start && await lo.seek(start);
        return new Stream2.Writable({
          highWaterMark,
          write(chunk, encoding, callback) {
            lo.write(chunk).then(() => callback(), callback);
          }
        });
      }
    }).catch(reject);
  });
}

// ../../node_modules/.pnpm/postgres@3.4.7/node_modules/postgres/src/index.js
Object.assign(Postgres, {
  PostgresError,
  toPascal,
  pascal,
  toCamel,
  camel,
  toKebab,
  kebab,
  fromPascal,
  fromCamel,
  fromKebab,
  BigInt: {
    to: 20,
    from: [20],
    parse: (x) => BigInt(x),
    // eslint-disable-line
    serialize: (x) => x.toString()
  }
});
var src_default = Postgres;
function Postgres(a, b2) {
  const options = parseOptions(a, b2), subscribe = options.no_subscribe || Subscribe(Postgres, { ...options });
  let ending = false;
  const queries = queue_default(), connecting = queue_default(), reserved = queue_default(), closed = queue_default(), ended = queue_default(), open = queue_default(), busy = queue_default(), full = queue_default(), queues = { connecting, reserved, closed, ended, open, busy, full };
  const connections = [...Array(options.max)].map(() => connection_default(options, queues, { onopen, onend, onclose }));
  const sql2 = Sql(handler);
  Object.assign(sql2, {
    get parameters() {
      return options.parameters;
    },
    largeObject: largeObject.bind(null, sql2),
    subscribe,
    CLOSE,
    END: CLOSE,
    PostgresError,
    options,
    reserve,
    listen,
    begin,
    close,
    end
  });
  return sql2;
  function Sql(handler2) {
    handler2.debug = options.debug;
    Object.entries(options.types).reduce((acc, [name, type]) => {
      acc[name] = (x) => new Parameter(x, type.to);
      return acc;
    }, typed);
    Object.assign(sql3, {
      types: typed,
      typed,
      unsafe,
      notify,
      array,
      json: json2,
      file
    });
    return sql3;
    function typed(value, type) {
      return new Parameter(value, type);
    }
    function sql3(strings, ...args) {
      const query = strings && Array.isArray(strings.raw) ? new Query(strings, args, handler2, cancel) : typeof strings === "string" && !args.length ? new Identifier(options.transform.column.to ? options.transform.column.to(strings) : strings) : new Builder(strings, args);
      return query;
    }
    function unsafe(string, args = [], options2 = {}) {
      arguments.length === 2 && !Array.isArray(args) && (options2 = args, args = []);
      const query = new Query([string], args, handler2, cancel, {
        prepare: false,
        ...options2,
        simple: "simple" in options2 ? options2.simple : args.length === 0
      });
      return query;
    }
    function file(path, args = [], options2 = {}) {
      arguments.length === 2 && !Array.isArray(args) && (options2 = args, args = []);
      const query = new Query([], args, (query2) => {
        fs.readFile(path, "utf8", (err, string) => {
          if (err)
            return query2.reject(err);
          query2.strings = [string];
          handler2(query2);
        });
      }, cancel, {
        ...options2,
        simple: "simple" in options2 ? options2.simple : args.length === 0
      });
      return query;
    }
  }
  async function listen(name, fn, onlisten) {
    const listener = { fn, onlisten };
    const sql3 = listen.sql || (listen.sql = Postgres({
      ...options,
      max: 1,
      idle_timeout: null,
      max_lifetime: null,
      fetch_types: false,
      onclose() {
        Object.entries(listen.channels).forEach(([name2, { listeners }]) => {
          delete listen.channels[name2];
          Promise.all(listeners.map((l) => listen(name2, l.fn, l.onlisten).catch(() => {
          })));
        });
      },
      onnotify(c, x) {
        c in listen.channels && listen.channels[c].listeners.forEach((l) => l.fn(x));
      }
    }));
    const channels = listen.channels || (listen.channels = {}), exists2 = name in channels;
    if (exists2) {
      channels[name].listeners.push(listener);
      const result2 = await channels[name].result;
      listener.onlisten && listener.onlisten();
      return { state: result2.state, unlisten };
    }
    channels[name] = { result: sql3`listen ${sql3.unsafe('"' + name.replace(/"/g, '""') + '"')}`, listeners: [listener] };
    const result = await channels[name].result;
    listener.onlisten && listener.onlisten();
    return { state: result.state, unlisten };
    async function unlisten() {
      if (name in channels === false)
        return;
      channels[name].listeners = channels[name].listeners.filter((x) => x !== listener);
      if (channels[name].listeners.length)
        return;
      delete channels[name];
      return sql3`unlisten ${sql3.unsafe('"' + name.replace(/"/g, '""') + '"')}`;
    }
  }
  async function notify(channel, payload) {
    return await sql2`select pg_notify(${channel}, ${"" + payload})`;
  }
  async function reserve() {
    const queue = queue_default();
    const c = open.length ? open.shift() : await new Promise((resolve, reject) => {
      const query = { reserve: resolve, reject };
      queries.push(query);
      closed.length && connect(closed.shift(), query);
    });
    move(c, reserved);
    c.reserved = () => queue.length ? c.execute(queue.shift()) : move(c, reserved);
    c.reserved.release = true;
    const sql3 = Sql(handler2);
    sql3.release = () => {
      c.reserved = null;
      onopen(c);
    };
    return sql3;
    function handler2(q) {
      c.queue === full ? queue.push(q) : c.execute(q) || move(c, full);
    }
  }
  async function begin(options2, fn) {
    !fn && (fn = options2, options2 = "");
    const queries2 = queue_default();
    let savepoints = 0, connection2, prepare = null;
    try {
      await sql2.unsafe("begin " + options2.replace(/[^a-z ]/ig, ""), [], { onexecute }).execute();
      return await Promise.race([
        scope(connection2, fn),
        new Promise((_, reject) => connection2.onclose = reject)
      ]);
    } catch (error) {
      throw error;
    }
    async function scope(c, fn2, name) {
      const sql3 = Sql(handler2);
      sql3.savepoint = savepoint;
      sql3.prepare = (x) => prepare = x.replace(/[^a-z0-9$-_. ]/gi);
      let uncaughtError, result;
      name && await sql3`savepoint ${sql3(name)}`;
      try {
        result = await new Promise((resolve, reject) => {
          const x = fn2(sql3);
          Promise.resolve(Array.isArray(x) ? Promise.all(x) : x).then(resolve, reject);
        });
        if (uncaughtError)
          throw uncaughtError;
      } catch (e) {
        await (name ? sql3`rollback to ${sql3(name)}` : sql3`rollback`);
        throw e instanceof PostgresError && e.code === "25P02" && uncaughtError || e;
      }
      if (!name) {
        prepare ? await sql3`prepare transaction '${sql3.unsafe(prepare)}'` : await sql3`commit`;
      }
      return result;
      function savepoint(name2, fn3) {
        if (name2 && Array.isArray(name2.raw))
          return savepoint((sql4) => sql4.apply(sql4, arguments));
        arguments.length === 1 && (fn3 = name2, name2 = null);
        return scope(c, fn3, "s" + savepoints++ + (name2 ? "_" + name2 : ""));
      }
      function handler2(q) {
        q.catch((e) => uncaughtError || (uncaughtError = e));
        c.queue === full ? queries2.push(q) : c.execute(q) || move(c, full);
      }
    }
    function onexecute(c) {
      connection2 = c;
      move(c, reserved);
      c.reserved = () => queries2.length ? c.execute(queries2.shift()) : move(c, reserved);
    }
  }
  function move(c, queue) {
    c.queue.remove(c);
    queue.push(c);
    c.queue = queue;
    queue === open ? c.idleTimer.start() : c.idleTimer.cancel();
    return c;
  }
  function json2(x) {
    return new Parameter(x, 3802);
  }
  function array(x, type) {
    if (!Array.isArray(x))
      return array(Array.from(arguments));
    return new Parameter(x, type || (x.length ? inferType(x) || 25 : 0), options.shared.typeArrayMap);
  }
  function handler(query) {
    if (ending)
      return query.reject(Errors.connection("CONNECTION_ENDED", options, options));
    if (open.length)
      return go(open.shift(), query);
    if (closed.length)
      return connect(closed.shift(), query);
    busy.length ? go(busy.shift(), query) : queries.push(query);
  }
  function go(c, query) {
    return c.execute(query) ? move(c, busy) : move(c, full);
  }
  function cancel(query) {
    return new Promise((resolve, reject) => {
      query.state ? query.active ? connection_default(options).cancel(query.state, resolve, reject) : query.cancelled = { resolve, reject } : (queries.remove(query), query.cancelled = true, query.reject(Errors.generic("57014", "canceling statement due to user request")), resolve());
    });
  }
  async function end({ timeout = null } = {}) {
    if (ending)
      return ending;
    await 1;
    let timer2;
    return ending = Promise.race([
      new Promise((r) => timeout !== null && (timer2 = setTimeout(destroy, timeout * 1e3, r))),
      Promise.all(connections.map((c) => c.end()).concat(
        listen.sql ? listen.sql.end({ timeout: 0 }) : [],
        subscribe.sql ? subscribe.sql.end({ timeout: 0 }) : []
      ))
    ]).then(() => clearTimeout(timer2));
  }
  async function close() {
    await Promise.all(connections.map((c) => c.end()));
  }
  async function destroy(resolve) {
    await Promise.all(connections.map((c) => c.terminate()));
    while (queries.length)
      queries.shift().reject(Errors.connection("CONNECTION_DESTROYED", options));
    resolve();
  }
  function connect(c, query) {
    move(c, connecting);
    c.connect(query);
    return c;
  }
  function onend(c) {
    move(c, ended);
  }
  function onopen(c) {
    if (queries.length === 0)
      return move(c, open);
    let max = Math.ceil(queries.length / (connecting.length + 1)), ready = true;
    while (ready && queries.length && max-- > 0) {
      const query = queries.shift();
      if (query.reserve)
        return query.reserve(c);
      ready = c.execute(query);
    }
    ready ? move(c, busy) : move(c, full);
  }
  function onclose(c, e) {
    move(c, closed);
    c.reserved = null;
    c.onclose && (c.onclose(e), c.onclose = null);
    options.onclose && options.onclose(c.id);
    queries.length && connect(c, queries.shift());
  }
}
function parseOptions(a, b2) {
  if (a && a.shared)
    return a;
  const env = process.env, o = (!a || typeof a === "string" ? b2 : a) || {}, { url, multihost } = parseUrl(a), query = [...url.searchParams].reduce((a2, [b3, c]) => (a2[b3] = c, a2), {}), host = o.hostname || o.host || multihost || url.hostname || env.PGHOST || "localhost", port = o.port || url.port || env.PGPORT || 5432, user = o.user || o.username || url.username || env.PGUSERNAME || env.PGUSER || osUsername();
  o.no_prepare && (o.prepare = false);
  query.sslmode && (query.ssl = query.sslmode, delete query.sslmode);
  "timeout" in o && (console.log("The timeout option is deprecated, use idle_timeout instead"), o.idle_timeout = o.timeout);
  query.sslrootcert === "system" && (query.ssl = "verify-full");
  const ints = ["idle_timeout", "connect_timeout", "max_lifetime", "max_pipeline", "backoff", "keep_alive"];
  const defaults = {
    max: 10,
    ssl: false,
    idle_timeout: null,
    connect_timeout: 30,
    max_lifetime,
    max_pipeline: 100,
    backoff,
    keep_alive: 60,
    prepare: true,
    debug: false,
    fetch_types: true,
    publications: "alltables",
    target_session_attrs: null
  };
  return {
    host: Array.isArray(host) ? host : host.split(",").map((x) => x.split(":")[0]),
    port: Array.isArray(port) ? port : host.split(",").map((x) => parseInt(x.split(":")[1] || port)),
    path: o.path || host.indexOf("/") > -1 && host + "/.s.PGSQL." + port,
    database: o.database || o.db || (url.pathname || "").slice(1) || env.PGDATABASE || user,
    user,
    pass: o.pass || o.password || url.password || env.PGPASSWORD || "",
    ...Object.entries(defaults).reduce(
      (acc, [k, d]) => {
        const value = k in o ? o[k] : k in query ? query[k] === "disable" || query[k] === "false" ? false : query[k] : env["PG" + k.toUpperCase()] || d;
        acc[k] = typeof value === "string" && ints.includes(k) ? +value : value;
        return acc;
      },
      {}
    ),
    connection: {
      application_name: env.PGAPPNAME || "postgres.js",
      ...o.connection,
      ...Object.entries(query).reduce((acc, [k, v]) => (k in defaults || (acc[k] = v), acc), {})
    },
    types: o.types || {},
    target_session_attrs: tsa(o, url, env),
    onnotice: o.onnotice,
    onnotify: o.onnotify,
    onclose: o.onclose,
    onparameter: o.onparameter,
    socket: o.socket,
    transform: parseTransform(o.transform || { undefined: void 0 }),
    parameters: {},
    shared: { retries: 0, typeArrayMap: {} },
    ...mergeUserTypes(o.types)
  };
}
function tsa(o, url, env) {
  const x = o.target_session_attrs || url.searchParams.get("target_session_attrs") || env.PGTARGETSESSIONATTRS;
  if (!x || ["read-write", "read-only", "primary", "standby", "prefer-standby"].includes(x))
    return x;
  throw new Error("target_session_attrs " + x + " is not supported");
}
function backoff(retries) {
  return (0.5 + Math.random() / 2) * Math.min(3 ** retries / 100, 20);
}
function max_lifetime() {
  return 60 * (30 + Math.random() * 30);
}
function parseTransform(x) {
  return {
    undefined: x.undefined,
    column: {
      from: typeof x.column === "function" ? x.column : x.column && x.column.from,
      to: x.column && x.column.to
    },
    value: {
      from: typeof x.value === "function" ? x.value : x.value && x.value.from,
      to: x.value && x.value.to
    },
    row: {
      from: typeof x.row === "function" ? x.row : x.row && x.row.from,
      to: x.row && x.row.to
    }
  };
}
function parseUrl(url) {
  if (!url || typeof url !== "string")
    return { url: { searchParams: /* @__PURE__ */ new Map() } };
  let host = url;
  host = host.slice(host.indexOf("://") + 3).split(/[?/]/)[0];
  host = decodeURIComponent(host.slice(host.indexOf("@") + 1));
  const urlObj = new URL(url.replace(host, host.split(",")[0]));
  return {
    url: {
      username: decodeURIComponent(urlObj.username),
      password: decodeURIComponent(urlObj.password),
      host: urlObj.host,
      hostname: urlObj.hostname,
      port: urlObj.port,
      pathname: urlObj.pathname,
      searchParams: urlObj.searchParams
    },
    multihost: host.indexOf(",") > -1 && host
  };
}
function osUsername() {
  try {
    return os.userInfo().username;
  } catch (_) {
    return process.env.USERNAME || process.env.USER || process.env.LOGNAME;
  }
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/selection-proxy.js
var SelectionProxyHandler = class _SelectionProxyHandler {
  static [entityKind] = "SelectionProxyHandler";
  config;
  constructor(config) {
    this.config = { ...config };
  }
  get(subquery, prop) {
    if (prop === "_") {
      return {
        ...subquery["_"],
        selectedFields: new Proxy(
          subquery._.selectedFields,
          this
        )
      };
    }
    if (prop === ViewBaseConfig) {
      return {
        ...subquery[ViewBaseConfig],
        selectedFields: new Proxy(
          subquery[ViewBaseConfig].selectedFields,
          this
        )
      };
    }
    if (typeof prop === "symbol") {
      return subquery[prop];
    }
    const columns = is(subquery, Subquery) ? subquery._.selectedFields : is(subquery, View) ? subquery[ViewBaseConfig].selectedFields : subquery;
    const value = columns[prop];
    if (is(value, SQL.Aliased)) {
      if (this.config.sqlAliasedBehavior === "sql" && !value.isSelectionField) {
        return value.sql;
      }
      const newValue = value.clone();
      newValue.isSelectionField = true;
      return newValue;
    }
    if (is(value, SQL)) {
      if (this.config.sqlBehavior === "sql") {
        return value;
      }
      throw new Error(
        `You tried to reference "${prop}" field from a subquery, which is a raw SQL field, but it doesn't have an alias declared. Please add an alias to the field using ".as('alias')" method.`
      );
    }
    if (is(value, Column)) {
      if (this.config.alias) {
        return new Proxy(
          value,
          new ColumnAliasProxyHandler(
            new Proxy(
              value.table,
              new TableAliasProxyHandler(this.config.alias, this.config.replaceOriginalName ?? false)
            )
          )
        );
      }
      return value;
    }
    if (typeof value !== "object" || value === null) {
      return value;
    }
    return new Proxy(value, new _SelectionProxyHandler(this.config));
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/indexes.js
var IndexBuilderOn = class {
  constructor(unique, name) {
    this.unique = unique;
    this.name = name;
  }
  static [entityKind] = "PgIndexBuilderOn";
  on(...columns) {
    return new IndexBuilder(
      columns.map((it) => {
        if (is(it, SQL)) {
          return it;
        }
        it = it;
        const clonedIndexedColumn = new IndexedColumn(it.name, !!it.keyAsName, it.columnType, it.indexConfig);
        it.indexConfig = JSON.parse(JSON.stringify(it.defaultConfig));
        return clonedIndexedColumn;
      }),
      this.unique,
      false,
      this.name
    );
  }
  onOnly(...columns) {
    return new IndexBuilder(
      columns.map((it) => {
        if (is(it, SQL)) {
          return it;
        }
        it = it;
        const clonedIndexedColumn = new IndexedColumn(it.name, !!it.keyAsName, it.columnType, it.indexConfig);
        it.indexConfig = it.defaultConfig;
        return clonedIndexedColumn;
      }),
      this.unique,
      true,
      this.name
    );
  }
  /**
   * Specify what index method to use. Choices are `btree`, `hash`, `gist`, `spgist`, `gin`, `brin`, or user-installed access methods like `bloom`. The default method is `btree.
   *
   * If you have the `pg_vector` extension installed in your database, you can use the `hnsw` and `ivfflat` options, which are predefined types.
   *
   * **You can always specify any string you want in the method, in case Drizzle doesn't have it natively in its types**
   *
   * @param method The name of the index method to be used
   * @param columns
   * @returns
   */
  using(method, ...columns) {
    return new IndexBuilder(
      columns.map((it) => {
        if (is(it, SQL)) {
          return it;
        }
        it = it;
        const clonedIndexedColumn = new IndexedColumn(it.name, !!it.keyAsName, it.columnType, it.indexConfig);
        it.indexConfig = JSON.parse(JSON.stringify(it.defaultConfig));
        return clonedIndexedColumn;
      }),
      this.unique,
      true,
      this.name,
      method
    );
  }
};
var IndexBuilder = class {
  static [entityKind] = "PgIndexBuilder";
  /** @internal */
  config;
  constructor(columns, unique, only, name, method = "btree") {
    this.config = {
      name,
      columns,
      unique,
      only,
      method
    };
  }
  concurrently() {
    this.config.concurrently = true;
    return this;
  }
  with(obj) {
    this.config.with = obj;
    return this;
  }
  where(condition) {
    this.config.where = condition;
    return this;
  }
  /** @internal */
  build(table) {
    return new Index(this.config, table);
  }
};
var Index = class {
  static [entityKind] = "PgIndex";
  config;
  constructor(config, table) {
    this.config = { ...config, table };
  }
};
function index(name) {
  return new IndexBuilderOn(false, name);
}
function uniqueIndex(name) {
  return new IndexBuilderOn(true, name);
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/casing.js
function toSnakeCase(input) {
  const words = input.replace(/['\u2019]/g, "").match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/g) ?? [];
  return words.map((word) => word.toLowerCase()).join("_");
}
function toCamelCase(input) {
  const words = input.replace(/['\u2019]/g, "").match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/g) ?? [];
  return words.reduce((acc, word, i) => {
    const formattedWord = i === 0 ? word.toLowerCase() : `${word[0].toUpperCase()}${word.slice(1)}`;
    return acc + formattedWord;
  }, "");
}
function noopCase(input) {
  return input;
}
var CasingCache = class {
  static [entityKind] = "CasingCache";
  /** @internal */
  cache = {};
  cachedTables = {};
  convert;
  constructor(casing) {
    this.convert = casing === "snake_case" ? toSnakeCase : casing === "camelCase" ? toCamelCase : noopCase;
  }
  getColumnCasing(column) {
    if (!column.keyAsName) return column.name;
    const schema = column.table[Table.Symbol.Schema] ?? "public";
    const tableName = column.table[Table.Symbol.OriginalName];
    const key = `${schema}.${tableName}.${column.name}`;
    if (!this.cache[key]) {
      this.cacheTable(column.table);
    }
    return this.cache[key];
  }
  cacheTable(table) {
    const schema = table[Table.Symbol.Schema] ?? "public";
    const tableName = table[Table.Symbol.OriginalName];
    const tableKey = `${schema}.${tableName}`;
    if (!this.cachedTables[tableKey]) {
      for (const column of Object.values(table[Table.Symbol.Columns])) {
        const columnKey = `${tableKey}.${column.name}`;
        this.cache[columnKey] = this.convert(column.name);
      }
      this.cachedTables[tableKey] = true;
    }
  }
  clearCache() {
    this.cache = {};
    this.cachedTables = {};
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/view-base.js
var PgViewBase = class extends View {
  static [entityKind] = "PgViewBase";
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/dialect.js
var PgDialect = class {
  static [entityKind] = "PgDialect";
  /** @internal */
  casing;
  constructor(config) {
    this.casing = new CasingCache(config?.casing);
  }
  async migrate(migrations, session, config) {
    const migrationsTable = typeof config === "string" ? "__drizzle_migrations" : config.migrationsTable ?? "__drizzle_migrations";
    const migrationsSchema = typeof config === "string" ? "drizzle" : config.migrationsSchema ?? "drizzle";
    const migrationTableCreate = sql`
			CREATE TABLE IF NOT EXISTS ${sql.identifier(migrationsSchema)}.${sql.identifier(migrationsTable)} (
				id SERIAL PRIMARY KEY,
				hash text NOT NULL,
				created_at bigint
			)
		`;
    await session.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier(migrationsSchema)}`);
    await session.execute(migrationTableCreate);
    const dbMigrations = await session.all(
      sql`select id, hash, created_at from ${sql.identifier(migrationsSchema)}.${sql.identifier(migrationsTable)} order by created_at desc limit 1`
    );
    const lastDbMigration = dbMigrations[0];
    await session.transaction(async (tx) => {
      for await (const migration of migrations) {
        if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) {
          for (const stmt of migration.sql) {
            await tx.execute(sql.raw(stmt));
          }
          await tx.execute(
            sql`insert into ${sql.identifier(migrationsSchema)}.${sql.identifier(migrationsTable)} ("hash", "created_at") values(${migration.hash}, ${migration.folderMillis})`
          );
        }
      }
    });
  }
  escapeName(name) {
    return `"${name}"`;
  }
  escapeParam(num) {
    return `$${num + 1}`;
  }
  escapeString(str) {
    return `'${str.replace(/'/g, "''")}'`;
  }
  buildWithCTE(queries) {
    if (!queries?.length) return void 0;
    const withSqlChunks = [sql`with `];
    for (const [i, w] of queries.entries()) {
      withSqlChunks.push(sql`${sql.identifier(w._.alias)} as (${w._.sql})`);
      if (i < queries.length - 1) {
        withSqlChunks.push(sql`, `);
      }
    }
    withSqlChunks.push(sql` `);
    return sql.join(withSqlChunks);
  }
  buildDeleteQuery({ table, where, returning, withList }) {
    const withSql = this.buildWithCTE(withList);
    const returningSql = returning ? sql` returning ${this.buildSelection(returning, { isSingleTable: true })}` : void 0;
    const whereSql = where ? sql` where ${where}` : void 0;
    return sql`${withSql}delete from ${table}${whereSql}${returningSql}`;
  }
  buildUpdateSet(table, set) {
    const tableColumns = table[Table.Symbol.Columns];
    const columnNames = Object.keys(tableColumns).filter(
      (colName) => set[colName] !== void 0 || tableColumns[colName]?.onUpdateFn !== void 0
    );
    const setSize = columnNames.length;
    return sql.join(columnNames.flatMap((colName, i) => {
      const col = tableColumns[colName];
      const onUpdateFnResult = col.onUpdateFn?.();
      const value = set[colName] ?? (is(onUpdateFnResult, SQL) ? onUpdateFnResult : sql.param(onUpdateFnResult, col));
      const res = sql`${sql.identifier(this.casing.getColumnCasing(col))} = ${value}`;
      if (i < setSize - 1) {
        return [res, sql.raw(", ")];
      }
      return [res];
    }));
  }
  buildUpdateQuery({ table, set, where, returning, withList, from, joins }) {
    const withSql = this.buildWithCTE(withList);
    const tableName = table[PgTable.Symbol.Name];
    const tableSchema = table[PgTable.Symbol.Schema];
    const origTableName = table[PgTable.Symbol.OriginalName];
    const alias = tableName === origTableName ? void 0 : tableName;
    const tableSql = sql`${tableSchema ? sql`${sql.identifier(tableSchema)}.` : void 0}${sql.identifier(origTableName)}${alias && sql` ${sql.identifier(alias)}`}`;
    const setSql = this.buildUpdateSet(table, set);
    const fromSql = from && sql.join([sql.raw(" from "), this.buildFromTable(from)]);
    const joinsSql = this.buildJoins(joins);
    const returningSql = returning ? sql` returning ${this.buildSelection(returning, { isSingleTable: !from })}` : void 0;
    const whereSql = where ? sql` where ${where}` : void 0;
    return sql`${withSql}update ${tableSql} set ${setSql}${fromSql}${joinsSql}${whereSql}${returningSql}`;
  }
  /**
   * Builds selection SQL with provided fields/expressions
   *
   * Examples:
   *
   * `select <selection> from`
   *
   * `insert ... returning <selection>`
   *
   * If `isSingleTable` is true, then columns won't be prefixed with table name
   */
  buildSelection(fields, { isSingleTable = false } = {}) {
    const columnsLen = fields.length;
    const chunks = fields.flatMap(({ field }, i) => {
      const chunk = [];
      if (is(field, SQL.Aliased) && field.isSelectionField) {
        chunk.push(sql.identifier(field.fieldAlias));
      } else if (is(field, SQL.Aliased) || is(field, SQL)) {
        const query = is(field, SQL.Aliased) ? field.sql : field;
        if (isSingleTable) {
          chunk.push(
            new SQL(
              query.queryChunks.map((c) => {
                if (is(c, PgColumn)) {
                  return sql.identifier(this.casing.getColumnCasing(c));
                }
                return c;
              })
            )
          );
        } else {
          chunk.push(query);
        }
        if (is(field, SQL.Aliased)) {
          chunk.push(sql` as ${sql.identifier(field.fieldAlias)}`);
        }
      } else if (is(field, Column)) {
        if (isSingleTable) {
          chunk.push(sql.identifier(this.casing.getColumnCasing(field)));
        } else {
          chunk.push(field);
        }
      } else if (is(field, Subquery)) {
        const entries = Object.entries(field._.selectedFields);
        if (entries.length === 1) {
          const entry = entries[0][1];
          const fieldDecoder = is(entry, SQL) ? entry.decoder : is(entry, Column) ? { mapFromDriverValue: (v) => entry.mapFromDriverValue(v) } : entry.sql.decoder;
          if (fieldDecoder) {
            field._.sql.decoder = fieldDecoder;
          }
        }
        chunk.push(field);
      }
      if (i < columnsLen - 1) {
        chunk.push(sql`, `);
      }
      return chunk;
    });
    return sql.join(chunks);
  }
  buildJoins(joins) {
    if (!joins || joins.length === 0) {
      return void 0;
    }
    const joinsArray = [];
    for (const [index2, joinMeta] of joins.entries()) {
      if (index2 === 0) {
        joinsArray.push(sql` `);
      }
      const table = joinMeta.table;
      const lateralSql = joinMeta.lateral ? sql` lateral` : void 0;
      const onSql = joinMeta.on ? sql` on ${joinMeta.on}` : void 0;
      if (is(table, PgTable)) {
        const tableName = table[PgTable.Symbol.Name];
        const tableSchema = table[PgTable.Symbol.Schema];
        const origTableName = table[PgTable.Symbol.OriginalName];
        const alias = tableName === origTableName ? void 0 : joinMeta.alias;
        joinsArray.push(
          sql`${sql.raw(joinMeta.joinType)} join${lateralSql} ${tableSchema ? sql`${sql.identifier(tableSchema)}.` : void 0}${sql.identifier(origTableName)}${alias && sql` ${sql.identifier(alias)}`}${onSql}`
        );
      } else if (is(table, View)) {
        const viewName = table[ViewBaseConfig].name;
        const viewSchema = table[ViewBaseConfig].schema;
        const origViewName = table[ViewBaseConfig].originalName;
        const alias = viewName === origViewName ? void 0 : joinMeta.alias;
        joinsArray.push(
          sql`${sql.raw(joinMeta.joinType)} join${lateralSql} ${viewSchema ? sql`${sql.identifier(viewSchema)}.` : void 0}${sql.identifier(origViewName)}${alias && sql` ${sql.identifier(alias)}`}${onSql}`
        );
      } else {
        joinsArray.push(
          sql`${sql.raw(joinMeta.joinType)} join${lateralSql} ${table}${onSql}`
        );
      }
      if (index2 < joins.length - 1) {
        joinsArray.push(sql` `);
      }
    }
    return sql.join(joinsArray);
  }
  buildFromTable(table) {
    if (is(table, Table) && table[Table.Symbol.IsAlias]) {
      let fullName = sql`${sql.identifier(table[Table.Symbol.OriginalName])}`;
      if (table[Table.Symbol.Schema]) {
        fullName = sql`${sql.identifier(table[Table.Symbol.Schema])}.${fullName}`;
      }
      return sql`${fullName} ${sql.identifier(table[Table.Symbol.Name])}`;
    }
    return table;
  }
  buildSelectQuery({
    withList,
    fields,
    fieldsFlat,
    where,
    having,
    table,
    joins,
    orderBy,
    groupBy,
    limit,
    offset,
    lockingClause,
    distinct,
    setOperators
  }) {
    const fieldsList = fieldsFlat ?? orderSelectedFields(fields);
    for (const f of fieldsList) {
      if (is(f.field, Column) && getTableName(f.field.table) !== (is(table, Subquery) ? table._.alias : is(table, PgViewBase) ? table[ViewBaseConfig].name : is(table, SQL) ? void 0 : getTableName(table)) && !((table2) => joins?.some(
        ({ alias }) => alias === (table2[Table.Symbol.IsAlias] ? getTableName(table2) : table2[Table.Symbol.BaseName])
      ))(f.field.table)) {
        const tableName = getTableName(f.field.table);
        throw new Error(
          `Your "${f.path.join("->")}" field references a column "${tableName}"."${f.field.name}", but the table "${tableName}" is not part of the query! Did you forget to join it?`
        );
      }
    }
    const isSingleTable = !joins || joins.length === 0;
    const withSql = this.buildWithCTE(withList);
    let distinctSql;
    if (distinct) {
      distinctSql = distinct === true ? sql` distinct` : sql` distinct on (${sql.join(distinct.on, sql`, `)})`;
    }
    const selection = this.buildSelection(fieldsList, { isSingleTable });
    const tableSql = this.buildFromTable(table);
    const joinsSql = this.buildJoins(joins);
    const whereSql = where ? sql` where ${where}` : void 0;
    const havingSql = having ? sql` having ${having}` : void 0;
    let orderBySql;
    if (orderBy && orderBy.length > 0) {
      orderBySql = sql` order by ${sql.join(orderBy, sql`, `)}`;
    }
    let groupBySql;
    if (groupBy && groupBy.length > 0) {
      groupBySql = sql` group by ${sql.join(groupBy, sql`, `)}`;
    }
    const limitSql = typeof limit === "object" || typeof limit === "number" && limit >= 0 ? sql` limit ${limit}` : void 0;
    const offsetSql = offset ? sql` offset ${offset}` : void 0;
    const lockingClauseSql = sql.empty();
    if (lockingClause) {
      const clauseSql = sql` for ${sql.raw(lockingClause.strength)}`;
      if (lockingClause.config.of) {
        clauseSql.append(
          sql` of ${sql.join(
            Array.isArray(lockingClause.config.of) ? lockingClause.config.of : [lockingClause.config.of],
            sql`, `
          )}`
        );
      }
      if (lockingClause.config.noWait) {
        clauseSql.append(sql` nowait`);
      } else if (lockingClause.config.skipLocked) {
        clauseSql.append(sql` skip locked`);
      }
      lockingClauseSql.append(clauseSql);
    }
    const finalQuery = sql`${withSql}select${distinctSql} ${selection} from ${tableSql}${joinsSql}${whereSql}${groupBySql}${havingSql}${orderBySql}${limitSql}${offsetSql}${lockingClauseSql}`;
    if (setOperators.length > 0) {
      return this.buildSetOperations(finalQuery, setOperators);
    }
    return finalQuery;
  }
  buildSetOperations(leftSelect, setOperators) {
    const [setOperator, ...rest] = setOperators;
    if (!setOperator) {
      throw new Error("Cannot pass undefined values to any set operator");
    }
    if (rest.length === 0) {
      return this.buildSetOperationQuery({ leftSelect, setOperator });
    }
    return this.buildSetOperations(
      this.buildSetOperationQuery({ leftSelect, setOperator }),
      rest
    );
  }
  buildSetOperationQuery({
    leftSelect,
    setOperator: { type, isAll, rightSelect, limit, orderBy, offset }
  }) {
    const leftChunk = sql`(${leftSelect.getSQL()}) `;
    const rightChunk = sql`(${rightSelect.getSQL()})`;
    let orderBySql;
    if (orderBy && orderBy.length > 0) {
      const orderByValues = [];
      for (const singleOrderBy of orderBy) {
        if (is(singleOrderBy, PgColumn)) {
          orderByValues.push(sql.identifier(singleOrderBy.name));
        } else if (is(singleOrderBy, SQL)) {
          for (let i = 0; i < singleOrderBy.queryChunks.length; i++) {
            const chunk = singleOrderBy.queryChunks[i];
            if (is(chunk, PgColumn)) {
              singleOrderBy.queryChunks[i] = sql.identifier(chunk.name);
            }
          }
          orderByValues.push(sql`${singleOrderBy}`);
        } else {
          orderByValues.push(sql`${singleOrderBy}`);
        }
      }
      orderBySql = sql` order by ${sql.join(orderByValues, sql`, `)} `;
    }
    const limitSql = typeof limit === "object" || typeof limit === "number" && limit >= 0 ? sql` limit ${limit}` : void 0;
    const operatorChunk = sql.raw(`${type} ${isAll ? "all " : ""}`);
    const offsetSql = offset ? sql` offset ${offset}` : void 0;
    return sql`${leftChunk}${operatorChunk}${rightChunk}${orderBySql}${limitSql}${offsetSql}`;
  }
  buildInsertQuery({ table, values: valuesOrSelect, onConflict, returning, withList, select: select2, overridingSystemValue_ }) {
    const valuesSqlList = [];
    const columns = table[Table.Symbol.Columns];
    const colEntries = Object.entries(columns).filter(([_, col]) => !col.shouldDisableInsert());
    const insertOrder = colEntries.map(
      ([, column]) => sql.identifier(this.casing.getColumnCasing(column))
    );
    if (select2) {
      const select22 = valuesOrSelect;
      if (is(select22, SQL)) {
        valuesSqlList.push(select22);
      } else {
        valuesSqlList.push(select22.getSQL());
      }
    } else {
      const values2 = valuesOrSelect;
      valuesSqlList.push(sql.raw("values "));
      for (const [valueIndex, value] of values2.entries()) {
        const valueList = [];
        for (const [fieldName, col] of colEntries) {
          const colValue = value[fieldName];
          if (colValue === void 0 || is(colValue, Param) && colValue.value === void 0) {
            if (col.defaultFn !== void 0) {
              const defaultFnResult = col.defaultFn();
              const defaultValue = is(defaultFnResult, SQL) ? defaultFnResult : sql.param(defaultFnResult, col);
              valueList.push(defaultValue);
            } else if (!col.default && col.onUpdateFn !== void 0) {
              const onUpdateFnResult = col.onUpdateFn();
              const newValue = is(onUpdateFnResult, SQL) ? onUpdateFnResult : sql.param(onUpdateFnResult, col);
              valueList.push(newValue);
            } else {
              valueList.push(sql`default`);
            }
          } else {
            valueList.push(colValue);
          }
        }
        valuesSqlList.push(valueList);
        if (valueIndex < values2.length - 1) {
          valuesSqlList.push(sql`, `);
        }
      }
    }
    const withSql = this.buildWithCTE(withList);
    const valuesSql = sql.join(valuesSqlList);
    const returningSql = returning ? sql` returning ${this.buildSelection(returning, { isSingleTable: true })}` : void 0;
    const onConflictSql = onConflict ? sql` on conflict ${onConflict}` : void 0;
    const overridingSql = overridingSystemValue_ === true ? sql`overriding system value ` : void 0;
    return sql`${withSql}insert into ${table} ${insertOrder} ${overridingSql}${valuesSql}${onConflictSql}${returningSql}`;
  }
  buildRefreshMaterializedViewQuery({ view, concurrently, withNoData }) {
    const concurrentlySql = concurrently ? sql` concurrently` : void 0;
    const withNoDataSql = withNoData ? sql` with no data` : void 0;
    return sql`refresh materialized view${concurrentlySql} ${view}${withNoDataSql}`;
  }
  prepareTyping(encoder) {
    if (is(encoder, PgJsonb) || is(encoder, PgJson)) {
      return "json";
    } else if (is(encoder, PgNumeric)) {
      return "decimal";
    } else if (is(encoder, PgTime)) {
      return "time";
    } else if (is(encoder, PgTimestamp) || is(encoder, PgTimestampString)) {
      return "timestamp";
    } else if (is(encoder, PgDate) || is(encoder, PgDateString)) {
      return "date";
    } else if (is(encoder, PgUUID)) {
      return "uuid";
    } else {
      return "none";
    }
  }
  sqlToQuery(sql2, invokeSource) {
    return sql2.toQuery({
      casing: this.casing,
      escapeName: this.escapeName,
      escapeParam: this.escapeParam,
      escapeString: this.escapeString,
      prepareTyping: this.prepareTyping,
      invokeSource
    });
  }
  // buildRelationalQueryWithPK({
  // 	fullSchema,
  // 	schema,
  // 	tableNamesMap,
  // 	table,
  // 	tableConfig,
  // 	queryConfig: config,
  // 	tableAlias,
  // 	isRoot = false,
  // 	joinOn,
  // }: {
  // 	fullSchema: Record<string, unknown>;
  // 	schema: TablesRelationalConfig;
  // 	tableNamesMap: Record<string, string>;
  // 	table: PgTable;
  // 	tableConfig: TableRelationalConfig;
  // 	queryConfig: true | DBQueryConfig<'many', true>;
  // 	tableAlias: string;
  // 	isRoot?: boolean;
  // 	joinOn?: SQL;
  // }): BuildRelationalQueryResult<PgTable, PgColumn> {
  // 	// For { "<relation>": true }, return a table with selection of all columns
  // 	if (config === true) {
  // 		const selectionEntries = Object.entries(tableConfig.columns);
  // 		const selection: BuildRelationalQueryResult<PgTable, PgColumn>['selection'] = selectionEntries.map((
  // 			[key, value],
  // 		) => ({
  // 			dbKey: value.name,
  // 			tsKey: key,
  // 			field: value as PgColumn,
  // 			relationTableTsKey: undefined,
  // 			isJson: false,
  // 			selection: [],
  // 		}));
  // 		return {
  // 			tableTsKey: tableConfig.tsName,
  // 			sql: table,
  // 			selection,
  // 		};
  // 	}
  // 	// let selection: BuildRelationalQueryResult<PgTable, PgColumn>['selection'] = [];
  // 	// let selectionForBuild = selection;
  // 	const aliasedColumns = Object.fromEntries(
  // 		Object.entries(tableConfig.columns).map(([key, value]) => [key, aliasedTableColumn(value, tableAlias)]),
  // 	);
  // 	const aliasedRelations = Object.fromEntries(
  // 		Object.entries(tableConfig.relations).map(([key, value]) => [key, aliasedRelation(value, tableAlias)]),
  // 	);
  // 	const aliasedFields = Object.assign({}, aliasedColumns, aliasedRelations);
  // 	let where, hasUserDefinedWhere;
  // 	if (config.where) {
  // 		const whereSql = typeof config.where === 'function' ? config.where(aliasedFields, operators) : config.where;
  // 		where = whereSql && mapColumnsInSQLToAlias(whereSql, tableAlias);
  // 		hasUserDefinedWhere = !!where;
  // 	}
  // 	where = and(joinOn, where);
  // 	// const fieldsSelection: { tsKey: string; value: PgColumn | SQL.Aliased; isExtra?: boolean }[] = [];
  // 	let joins: Join[] = [];
  // 	let selectedColumns: string[] = [];
  // 	// Figure out which columns to select
  // 	if (config.columns) {
  // 		let isIncludeMode = false;
  // 		for (const [field, value] of Object.entries(config.columns)) {
  // 			if (value === undefined) {
  // 				continue;
  // 			}
  // 			if (field in tableConfig.columns) {
  // 				if (!isIncludeMode && value === true) {
  // 					isIncludeMode = true;
  // 				}
  // 				selectedColumns.push(field);
  // 			}
  // 		}
  // 		if (selectedColumns.length > 0) {
  // 			selectedColumns = isIncludeMode
  // 				? selectedColumns.filter((c) => config.columns?.[c] === true)
  // 				: Object.keys(tableConfig.columns).filter((key) => !selectedColumns.includes(key));
  // 		}
  // 	} else {
  // 		// Select all columns if selection is not specified
  // 		selectedColumns = Object.keys(tableConfig.columns);
  // 	}
  // 	// for (const field of selectedColumns) {
  // 	// 	const column = tableConfig.columns[field]! as PgColumn;
  // 	// 	fieldsSelection.push({ tsKey: field, value: column });
  // 	// }
  // 	let initiallySelectedRelations: {
  // 		tsKey: string;
  // 		queryConfig: true | DBQueryConfig<'many', false>;
  // 		relation: Relation;
  // 	}[] = [];
  // 	// let selectedRelations: BuildRelationalQueryResult<PgTable, PgColumn>['selection'] = [];
  // 	// Figure out which relations to select
  // 	if (config.with) {
  // 		initiallySelectedRelations = Object.entries(config.with)
  // 			.filter((entry): entry is [typeof entry[0], NonNullable<typeof entry[1]>] => !!entry[1])
  // 			.map(([tsKey, queryConfig]) => ({ tsKey, queryConfig, relation: tableConfig.relations[tsKey]! }));
  // 	}
  // 	const manyRelations = initiallySelectedRelations.filter((r) =>
  // 		is(r.relation, Many)
  // 		&& (schema[tableNamesMap[r.relation.referencedTable[Table.Symbol.Name]]!]?.primaryKey.length ?? 0) > 0
  // 	);
  // 	// If this is the last Many relation (or there are no Many relations), we are on the innermost subquery level
  // 	const isInnermostQuery = manyRelations.length < 2;
  // 	const selectedExtras: {
  // 		tsKey: string;
  // 		value: SQL.Aliased;
  // 	}[] = [];
  // 	// Figure out which extras to select
  // 	if (isInnermostQuery && config.extras) {
  // 		const extras = typeof config.extras === 'function'
  // 			? config.extras(aliasedFields, { sql })
  // 			: config.extras;
  // 		for (const [tsKey, value] of Object.entries(extras)) {
  // 			selectedExtras.push({
  // 				tsKey,
  // 				value: mapColumnsInAliasedSQLToAlias(value, tableAlias),
  // 			});
  // 		}
  // 	}
  // 	// Transform `fieldsSelection` into `selection`
  // 	// `fieldsSelection` shouldn't be used after this point
  // 	// for (const { tsKey, value, isExtra } of fieldsSelection) {
  // 	// 	selection.push({
  // 	// 		dbKey: is(value, SQL.Aliased) ? value.fieldAlias : tableConfig.columns[tsKey]!.name,
  // 	// 		tsKey,
  // 	// 		field: is(value, Column) ? aliasedTableColumn(value, tableAlias) : value,
  // 	// 		relationTableTsKey: undefined,
  // 	// 		isJson: false,
  // 	// 		isExtra,
  // 	// 		selection: [],
  // 	// 	});
  // 	// }
  // 	let orderByOrig = typeof config.orderBy === 'function'
  // 		? config.orderBy(aliasedFields, orderByOperators)
  // 		: config.orderBy ?? [];
  // 	if (!Array.isArray(orderByOrig)) {
  // 		orderByOrig = [orderByOrig];
  // 	}
  // 	const orderBy = orderByOrig.map((orderByValue) => {
  // 		if (is(orderByValue, Column)) {
  // 			return aliasedTableColumn(orderByValue, tableAlias) as PgColumn;
  // 		}
  // 		return mapColumnsInSQLToAlias(orderByValue, tableAlias);
  // 	});
  // 	const limit = isInnermostQuery ? config.limit : undefined;
  // 	const offset = isInnermostQuery ? config.offset : undefined;
  // 	// For non-root queries without additional config except columns, return a table with selection
  // 	if (
  // 		!isRoot
  // 		&& initiallySelectedRelations.length === 0
  // 		&& selectedExtras.length === 0
  // 		&& !where
  // 		&& orderBy.length === 0
  // 		&& limit === undefined
  // 		&& offset === undefined
  // 	) {
  // 		return {
  // 			tableTsKey: tableConfig.tsName,
  // 			sql: table,
  // 			selection: selectedColumns.map((key) => ({
  // 				dbKey: tableConfig.columns[key]!.name,
  // 				tsKey: key,
  // 				field: tableConfig.columns[key] as PgColumn,
  // 				relationTableTsKey: undefined,
  // 				isJson: false,
  // 				selection: [],
  // 			})),
  // 		};
  // 	}
  // 	const selectedRelationsWithoutPK:
  // 	// Process all relations without primary keys, because they need to be joined differently and will all be on the same query level
  // 	for (
  // 		const {
  // 			tsKey: selectedRelationTsKey,
  // 			queryConfig: selectedRelationConfigValue,
  // 			relation,
  // 		} of initiallySelectedRelations
  // 	) {
  // 		const normalizedRelation = normalizeRelation(schema, tableNamesMap, relation);
  // 		const relationTableName = relation.referencedTable[Table.Symbol.Name];
  // 		const relationTableTsName = tableNamesMap[relationTableName]!;
  // 		const relationTable = schema[relationTableTsName]!;
  // 		if (relationTable.primaryKey.length > 0) {
  // 			continue;
  // 		}
  // 		const relationTableAlias = `${tableAlias}_${selectedRelationTsKey}`;
  // 		const joinOn = and(
  // 			...normalizedRelation.fields.map((field, i) =>
  // 				eq(
  // 					aliasedTableColumn(normalizedRelation.references[i]!, relationTableAlias),
  // 					aliasedTableColumn(field, tableAlias),
  // 				)
  // 			),
  // 		);
  // 		const builtRelation = this.buildRelationalQueryWithoutPK({
  // 			fullSchema,
  // 			schema,
  // 			tableNamesMap,
  // 			table: fullSchema[relationTableTsName] as PgTable,
  // 			tableConfig: schema[relationTableTsName]!,
  // 			queryConfig: selectedRelationConfigValue,
  // 			tableAlias: relationTableAlias,
  // 			joinOn,
  // 			nestedQueryRelation: relation,
  // 		});
  // 		const field = sql`${sql.identifier(relationTableAlias)}.${sql.identifier('data')}`.as(selectedRelationTsKey);
  // 		joins.push({
  // 			on: sql`true`,
  // 			table: new Subquery(builtRelation.sql as SQL, {}, relationTableAlias),
  // 			alias: relationTableAlias,
  // 			joinType: 'left',
  // 			lateral: true,
  // 		});
  // 		selectedRelations.push({
  // 			dbKey: selectedRelationTsKey,
  // 			tsKey: selectedRelationTsKey,
  // 			field,
  // 			relationTableTsKey: relationTableTsName,
  // 			isJson: true,
  // 			selection: builtRelation.selection,
  // 		});
  // 	}
  // 	const oneRelations = initiallySelectedRelations.filter((r): r is typeof r & { relation: One } =>
  // 		is(r.relation, One)
  // 	);
  // 	// Process all One relations with PKs, because they can all be joined on the same level
  // 	for (
  // 		const {
  // 			tsKey: selectedRelationTsKey,
  // 			queryConfig: selectedRelationConfigValue,
  // 			relation,
  // 		} of oneRelations
  // 	) {
  // 		const normalizedRelation = normalizeRelation(schema, tableNamesMap, relation);
  // 		const relationTableName = relation.referencedTable[Table.Symbol.Name];
  // 		const relationTableTsName = tableNamesMap[relationTableName]!;
  // 		const relationTableAlias = `${tableAlias}_${selectedRelationTsKey}`;
  // 		const relationTable = schema[relationTableTsName]!;
  // 		if (relationTable.primaryKey.length === 0) {
  // 			continue;
  // 		}
  // 		const joinOn = and(
  // 			...normalizedRelation.fields.map((field, i) =>
  // 				eq(
  // 					aliasedTableColumn(normalizedRelation.references[i]!, relationTableAlias),
  // 					aliasedTableColumn(field, tableAlias),
  // 				)
  // 			),
  // 		);
  // 		const builtRelation = this.buildRelationalQueryWithPK({
  // 			fullSchema,
  // 			schema,
  // 			tableNamesMap,
  // 			table: fullSchema[relationTableTsName] as PgTable,
  // 			tableConfig: schema[relationTableTsName]!,
  // 			queryConfig: selectedRelationConfigValue,
  // 			tableAlias: relationTableAlias,
  // 			joinOn,
  // 		});
  // 		const field = sql`case when ${sql.identifier(relationTableAlias)} is null then null else json_build_array(${
  // 			sql.join(
  // 				builtRelation.selection.map(({ field }) =>
  // 					is(field, SQL.Aliased)
  // 						? sql`${sql.identifier(relationTableAlias)}.${sql.identifier(field.fieldAlias)}`
  // 						: is(field, Column)
  // 						? aliasedTableColumn(field, relationTableAlias)
  // 						: field
  // 				),
  // 				sql`, `,
  // 			)
  // 		}) end`.as(selectedRelationTsKey);
  // 		const isLateralJoin = is(builtRelation.sql, SQL);
  // 		joins.push({
  // 			on: isLateralJoin ? sql`true` : joinOn,
  // 			table: is(builtRelation.sql, SQL)
  // 				? new Subquery(builtRelation.sql, {}, relationTableAlias)
  // 				: aliasedTable(builtRelation.sql, relationTableAlias),
  // 			alias: relationTableAlias,
  // 			joinType: 'left',
  // 			lateral: is(builtRelation.sql, SQL),
  // 		});
  // 		selectedRelations.push({
  // 			dbKey: selectedRelationTsKey,
  // 			tsKey: selectedRelationTsKey,
  // 			field,
  // 			relationTableTsKey: relationTableTsName,
  // 			isJson: true,
  // 			selection: builtRelation.selection,
  // 		});
  // 	}
  // 	let distinct: PgSelectConfig['distinct'];
  // 	let tableFrom: PgTable | Subquery = table;
  // 	// Process first Many relation - each one requires a nested subquery
  // 	const manyRelation = manyRelations[0];
  // 	if (manyRelation) {
  // 		const {
  // 			tsKey: selectedRelationTsKey,
  // 			queryConfig: selectedRelationQueryConfig,
  // 			relation,
  // 		} = manyRelation;
  // 		distinct = {
  // 			on: tableConfig.primaryKey.map((c) => aliasedTableColumn(c as PgColumn, tableAlias)),
  // 		};
  // 		const normalizedRelation = normalizeRelation(schema, tableNamesMap, relation);
  // 		const relationTableName = relation.referencedTable[Table.Symbol.Name];
  // 		const relationTableTsName = tableNamesMap[relationTableName]!;
  // 		const relationTableAlias = `${tableAlias}_${selectedRelationTsKey}`;
  // 		const joinOn = and(
  // 			...normalizedRelation.fields.map((field, i) =>
  // 				eq(
  // 					aliasedTableColumn(normalizedRelation.references[i]!, relationTableAlias),
  // 					aliasedTableColumn(field, tableAlias),
  // 				)
  // 			),
  // 		);
  // 		const builtRelationJoin = this.buildRelationalQueryWithPK({
  // 			fullSchema,
  // 			schema,
  // 			tableNamesMap,
  // 			table: fullSchema[relationTableTsName] as PgTable,
  // 			tableConfig: schema[relationTableTsName]!,
  // 			queryConfig: selectedRelationQueryConfig,
  // 			tableAlias: relationTableAlias,
  // 			joinOn,
  // 		});
  // 		const builtRelationSelectionField = sql`case when ${
  // 			sql.identifier(relationTableAlias)
  // 		} is null then '[]' else json_agg(json_build_array(${
  // 			sql.join(
  // 				builtRelationJoin.selection.map(({ field }) =>
  // 					is(field, SQL.Aliased)
  // 						? sql`${sql.identifier(relationTableAlias)}.${sql.identifier(field.fieldAlias)}`
  // 						: is(field, Column)
  // 						? aliasedTableColumn(field, relationTableAlias)
  // 						: field
  // 				),
  // 				sql`, `,
  // 			)
  // 		})) over (partition by ${sql.join(distinct.on, sql`, `)}) end`.as(selectedRelationTsKey);
  // 		const isLateralJoin = is(builtRelationJoin.sql, SQL);
  // 		joins.push({
  // 			on: isLateralJoin ? sql`true` : joinOn,
  // 			table: isLateralJoin
  // 				? new Subquery(builtRelationJoin.sql as SQL, {}, relationTableAlias)
  // 				: aliasedTable(builtRelationJoin.sql as PgTable, relationTableAlias),
  // 			alias: relationTableAlias,
  // 			joinType: 'left',
  // 			lateral: isLateralJoin,
  // 		});
  // 		// Build the "from" subquery with the remaining Many relations
  // 		const builtTableFrom = this.buildRelationalQueryWithPK({
  // 			fullSchema,
  // 			schema,
  // 			tableNamesMap,
  // 			table,
  // 			tableConfig,
  // 			queryConfig: {
  // 				...config,
  // 				where: undefined,
  // 				orderBy: undefined,
  // 				limit: undefined,
  // 				offset: undefined,
  // 				with: manyRelations.slice(1).reduce<NonNullable<typeof config['with']>>(
  // 					(result, { tsKey, queryConfig: configValue }) => {
  // 						result[tsKey] = configValue;
  // 						return result;
  // 					},
  // 					{},
  // 				),
  // 			},
  // 			tableAlias,
  // 		});
  // 		selectedRelations.push({
  // 			dbKey: selectedRelationTsKey,
  // 			tsKey: selectedRelationTsKey,
  // 			field: builtRelationSelectionField,
  // 			relationTableTsKey: relationTableTsName,
  // 			isJson: true,
  // 			selection: builtRelationJoin.selection,
  // 		});
  // 		// selection = builtTableFrom.selection.map((item) =>
  // 		// 	is(item.field, SQL.Aliased)
  // 		// 		? { ...item, field: sql`${sql.identifier(tableAlias)}.${sql.identifier(item.field.fieldAlias)}` }
  // 		// 		: item
  // 		// );
  // 		// selectionForBuild = [{
  // 		// 	dbKey: '*',
  // 		// 	tsKey: '*',
  // 		// 	field: sql`${sql.identifier(tableAlias)}.*`,
  // 		// 	selection: [],
  // 		// 	isJson: false,
  // 		// 	relationTableTsKey: undefined,
  // 		// }];
  // 		// const newSelectionItem: (typeof selection)[number] = {
  // 		// 	dbKey: selectedRelationTsKey,
  // 		// 	tsKey: selectedRelationTsKey,
  // 		// 	field,
  // 		// 	relationTableTsKey: relationTableTsName,
  // 		// 	isJson: true,
  // 		// 	selection: builtRelationJoin.selection,
  // 		// };
  // 		// selection.push(newSelectionItem);
  // 		// selectionForBuild.push(newSelectionItem);
  // 		tableFrom = is(builtTableFrom.sql, PgTable)
  // 			? builtTableFrom.sql
  // 			: new Subquery(builtTableFrom.sql, {}, tableAlias);
  // 	}
  // 	if (selectedColumns.length === 0 && selectedRelations.length === 0 && selectedExtras.length === 0) {
  // 		throw new DrizzleError(`No fields selected for table "${tableConfig.tsName}" ("${tableAlias}")`);
  // 	}
  // 	let selection: BuildRelationalQueryResult<PgTable, PgColumn>['selection'];
  // 	function prepareSelectedColumns() {
  // 		return selectedColumns.map((key) => ({
  // 			dbKey: tableConfig.columns[key]!.name,
  // 			tsKey: key,
  // 			field: tableConfig.columns[key] as PgColumn,
  // 			relationTableTsKey: undefined,
  // 			isJson: false,
  // 			selection: [],
  // 		}));
  // 	}
  // 	function prepareSelectedExtras() {
  // 		return selectedExtras.map((item) => ({
  // 			dbKey: item.value.fieldAlias,
  // 			tsKey: item.tsKey,
  // 			field: item.value,
  // 			relationTableTsKey: undefined,
  // 			isJson: false,
  // 			selection: [],
  // 		}));
  // 	}
  // 	if (isRoot) {
  // 		selection = [
  // 			...prepareSelectedColumns(),
  // 			...prepareSelectedExtras(),
  // 		];
  // 	}
  // 	if (hasUserDefinedWhere || orderBy.length > 0) {
  // 		tableFrom = new Subquery(
  // 			this.buildSelectQuery({
  // 				table: is(tableFrom, PgTable) ? aliasedTable(tableFrom, tableAlias) : tableFrom,
  // 				fields: {},
  // 				fieldsFlat: selectionForBuild.map(({ field }) => ({
  // 					path: [],
  // 					field: is(field, Column) ? aliasedTableColumn(field, tableAlias) : field,
  // 				})),
  // 				joins,
  // 				distinct,
  // 			}),
  // 			{},
  // 			tableAlias,
  // 		);
  // 		selectionForBuild = selection.map((item) =>
  // 			is(item.field, SQL.Aliased)
  // 				? { ...item, field: sql`${sql.identifier(tableAlias)}.${sql.identifier(item.field.fieldAlias)}` }
  // 				: item
  // 		);
  // 		joins = [];
  // 		distinct = undefined;
  // 	}
  // 	const result = this.buildSelectQuery({
  // 		table: is(tableFrom, PgTable) ? aliasedTable(tableFrom, tableAlias) : tableFrom,
  // 		fields: {},
  // 		fieldsFlat: selectionForBuild.map(({ field }) => ({
  // 			path: [],
  // 			field: is(field, Column) ? aliasedTableColumn(field, tableAlias) : field,
  // 		})),
  // 		where,
  // 		limit,
  // 		offset,
  // 		joins,
  // 		orderBy,
  // 		distinct,
  // 	});
  // 	return {
  // 		tableTsKey: tableConfig.tsName,
  // 		sql: result,
  // 		selection,
  // 	};
  // }
  buildRelationalQueryWithoutPK({
    fullSchema,
    schema,
    tableNamesMap,
    table,
    tableConfig,
    queryConfig: config,
    tableAlias,
    nestedQueryRelation,
    joinOn
  }) {
    let selection = [];
    let limit, offset, orderBy = [], where;
    const joins = [];
    if (config === true) {
      const selectionEntries = Object.entries(tableConfig.columns);
      selection = selectionEntries.map(([key, value]) => ({
        dbKey: value.name,
        tsKey: key,
        field: aliasedTableColumn(value, tableAlias),
        relationTableTsKey: void 0,
        isJson: false,
        selection: []
      }));
    } else {
      const aliasedColumns = Object.fromEntries(
        Object.entries(tableConfig.columns).map(([key, value]) => [key, aliasedTableColumn(value, tableAlias)])
      );
      if (config.where) {
        const whereSql = typeof config.where === "function" ? config.where(aliasedColumns, getOperators()) : config.where;
        where = whereSql && mapColumnsInSQLToAlias(whereSql, tableAlias);
      }
      const fieldsSelection = [];
      let selectedColumns = [];
      if (config.columns) {
        let isIncludeMode = false;
        for (const [field, value] of Object.entries(config.columns)) {
          if (value === void 0) {
            continue;
          }
          if (field in tableConfig.columns) {
            if (!isIncludeMode && value === true) {
              isIncludeMode = true;
            }
            selectedColumns.push(field);
          }
        }
        if (selectedColumns.length > 0) {
          selectedColumns = isIncludeMode ? selectedColumns.filter((c) => config.columns?.[c] === true) : Object.keys(tableConfig.columns).filter((key) => !selectedColumns.includes(key));
        }
      } else {
        selectedColumns = Object.keys(tableConfig.columns);
      }
      for (const field of selectedColumns) {
        const column = tableConfig.columns[field];
        fieldsSelection.push({ tsKey: field, value: column });
      }
      let selectedRelations = [];
      if (config.with) {
        selectedRelations = Object.entries(config.with).filter((entry) => !!entry[1]).map(([tsKey, queryConfig]) => ({ tsKey, queryConfig, relation: tableConfig.relations[tsKey] }));
      }
      let extras;
      if (config.extras) {
        extras = typeof config.extras === "function" ? config.extras(aliasedColumns, { sql }) : config.extras;
        for (const [tsKey, value] of Object.entries(extras)) {
          fieldsSelection.push({
            tsKey,
            value: mapColumnsInAliasedSQLToAlias(value, tableAlias)
          });
        }
      }
      for (const { tsKey, value } of fieldsSelection) {
        selection.push({
          dbKey: is(value, SQL.Aliased) ? value.fieldAlias : tableConfig.columns[tsKey].name,
          tsKey,
          field: is(value, Column) ? aliasedTableColumn(value, tableAlias) : value,
          relationTableTsKey: void 0,
          isJson: false,
          selection: []
        });
      }
      let orderByOrig = typeof config.orderBy === "function" ? config.orderBy(aliasedColumns, getOrderByOperators()) : config.orderBy ?? [];
      if (!Array.isArray(orderByOrig)) {
        orderByOrig = [orderByOrig];
      }
      orderBy = orderByOrig.map((orderByValue) => {
        if (is(orderByValue, Column)) {
          return aliasedTableColumn(orderByValue, tableAlias);
        }
        return mapColumnsInSQLToAlias(orderByValue, tableAlias);
      });
      limit = config.limit;
      offset = config.offset;
      for (const {
        tsKey: selectedRelationTsKey,
        queryConfig: selectedRelationConfigValue,
        relation
      } of selectedRelations) {
        const normalizedRelation = normalizeRelation(schema, tableNamesMap, relation);
        const relationTableName = getTableUniqueName(relation.referencedTable);
        const relationTableTsName = tableNamesMap[relationTableName];
        const relationTableAlias = `${tableAlias}_${selectedRelationTsKey}`;
        const joinOn2 = and(
          ...normalizedRelation.fields.map(
            (field2, i) => eq(
              aliasedTableColumn(normalizedRelation.references[i], relationTableAlias),
              aliasedTableColumn(field2, tableAlias)
            )
          )
        );
        const builtRelation = this.buildRelationalQueryWithoutPK({
          fullSchema,
          schema,
          tableNamesMap,
          table: fullSchema[relationTableTsName],
          tableConfig: schema[relationTableTsName],
          queryConfig: is(relation, One) ? selectedRelationConfigValue === true ? { limit: 1 } : { ...selectedRelationConfigValue, limit: 1 } : selectedRelationConfigValue,
          tableAlias: relationTableAlias,
          joinOn: joinOn2,
          nestedQueryRelation: relation
        });
        const field = sql`${sql.identifier(relationTableAlias)}.${sql.identifier("data")}`.as(selectedRelationTsKey);
        joins.push({
          on: sql`true`,
          table: new Subquery(builtRelation.sql, {}, relationTableAlias),
          alias: relationTableAlias,
          joinType: "left",
          lateral: true
        });
        selection.push({
          dbKey: selectedRelationTsKey,
          tsKey: selectedRelationTsKey,
          field,
          relationTableTsKey: relationTableTsName,
          isJson: true,
          selection: builtRelation.selection
        });
      }
    }
    if (selection.length === 0) {
      throw new DrizzleError({ message: `No fields selected for table "${tableConfig.tsName}" ("${tableAlias}")` });
    }
    let result;
    where = and(joinOn, where);
    if (nestedQueryRelation) {
      let field = sql`json_build_array(${sql.join(
        selection.map(
          ({ field: field2, tsKey, isJson }) => isJson ? sql`${sql.identifier(`${tableAlias}_${tsKey}`)}.${sql.identifier("data")}` : is(field2, SQL.Aliased) ? field2.sql : field2
        ),
        sql`, `
      )})`;
      if (is(nestedQueryRelation, Many)) {
        field = sql`coalesce(json_agg(${field}${orderBy.length > 0 ? sql` order by ${sql.join(orderBy, sql`, `)}` : void 0}), '[]'::json)`;
      }
      const nestedSelection = [{
        dbKey: "data",
        tsKey: "data",
        field: field.as("data"),
        isJson: true,
        relationTableTsKey: tableConfig.tsName,
        selection
      }];
      const needsSubquery = limit !== void 0 || offset !== void 0 || orderBy.length > 0;
      if (needsSubquery) {
        result = this.buildSelectQuery({
          table: aliasedTable(table, tableAlias),
          fields: {},
          fieldsFlat: [{
            path: [],
            field: sql.raw("*")
          }],
          where,
          limit,
          offset,
          orderBy,
          setOperators: []
        });
        where = void 0;
        limit = void 0;
        offset = void 0;
        orderBy = [];
      } else {
        result = aliasedTable(table, tableAlias);
      }
      result = this.buildSelectQuery({
        table: is(result, PgTable) ? result : new Subquery(result, {}, tableAlias),
        fields: {},
        fieldsFlat: nestedSelection.map(({ field: field2 }) => ({
          path: [],
          field: is(field2, Column) ? aliasedTableColumn(field2, tableAlias) : field2
        })),
        joins,
        where,
        limit,
        offset,
        orderBy,
        setOperators: []
      });
    } else {
      result = this.buildSelectQuery({
        table: aliasedTable(table, tableAlias),
        fields: {},
        fieldsFlat: selection.map(({ field }) => ({
          path: [],
          field: is(field, Column) ? aliasedTableColumn(field, tableAlias) : field
        })),
        joins,
        where,
        limit,
        offset,
        orderBy,
        setOperators: []
      });
    }
    return {
      tableTsKey: tableConfig.tsName,
      sql: result,
      selection
    };
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/query-builders/query-builder.js
var TypedQueryBuilder = class {
  static [entityKind] = "TypedQueryBuilder";
  /** @internal */
  getSelectedFields() {
    return this._.selectedFields;
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/query-builders/select.js
var PgSelectBuilder = class {
  static [entityKind] = "PgSelectBuilder";
  fields;
  session;
  dialect;
  withList = [];
  distinct;
  constructor(config) {
    this.fields = config.fields;
    this.session = config.session;
    this.dialect = config.dialect;
    if (config.withList) {
      this.withList = config.withList;
    }
    this.distinct = config.distinct;
  }
  authToken;
  /** @internal */
  setToken(token2) {
    this.authToken = token2;
    return this;
  }
  /**
   * Specify the table, subquery, or other target that you're
   * building a select query against.
   *
   * {@link https://www.postgresql.org/docs/current/sql-select.html#SQL-FROM | Postgres from documentation}
   */
  from(source) {
    const isPartialSelect = !!this.fields;
    const src = source;
    let fields;
    if (this.fields) {
      fields = this.fields;
    } else if (is(src, Subquery)) {
      fields = Object.fromEntries(
        Object.keys(src._.selectedFields).map((key) => [key, src[key]])
      );
    } else if (is(src, PgViewBase)) {
      fields = src[ViewBaseConfig].selectedFields;
    } else if (is(src, SQL)) {
      fields = {};
    } else {
      fields = getTableColumns(src);
    }
    return new PgSelectBase({
      table: src,
      fields,
      isPartialSelect,
      session: this.session,
      dialect: this.dialect,
      withList: this.withList,
      distinct: this.distinct
    }).setToken(this.authToken);
  }
};
var PgSelectQueryBuilderBase = class extends TypedQueryBuilder {
  static [entityKind] = "PgSelectQueryBuilder";
  _;
  config;
  joinsNotNullableMap;
  tableName;
  isPartialSelect;
  session;
  dialect;
  cacheConfig = void 0;
  usedTables = /* @__PURE__ */ new Set();
  constructor({ table, fields, isPartialSelect, session, dialect, withList, distinct }) {
    super();
    this.config = {
      withList,
      table,
      fields: { ...fields },
      distinct,
      setOperators: []
    };
    this.isPartialSelect = isPartialSelect;
    this.session = session;
    this.dialect = dialect;
    this._ = {
      selectedFields: fields,
      config: this.config
    };
    this.tableName = getTableLikeName(table);
    this.joinsNotNullableMap = typeof this.tableName === "string" ? { [this.tableName]: true } : {};
    for (const item of extractUsedTable(table)) this.usedTables.add(item);
  }
  /** @internal */
  getUsedTables() {
    return [...this.usedTables];
  }
  createJoin(joinType, lateral) {
    return (table, on) => {
      const baseTableName = this.tableName;
      const tableName = getTableLikeName(table);
      for (const item of extractUsedTable(table)) this.usedTables.add(item);
      if (typeof tableName === "string" && this.config.joins?.some((join) => join.alias === tableName)) {
        throw new Error(`Alias "${tableName}" is already used in this query`);
      }
      if (!this.isPartialSelect) {
        if (Object.keys(this.joinsNotNullableMap).length === 1 && typeof baseTableName === "string") {
          this.config.fields = {
            [baseTableName]: this.config.fields
          };
        }
        if (typeof tableName === "string" && !is(table, SQL)) {
          const selection = is(table, Subquery) ? table._.selectedFields : is(table, View) ? table[ViewBaseConfig].selectedFields : table[Table.Symbol.Columns];
          this.config.fields[tableName] = selection;
        }
      }
      if (typeof on === "function") {
        on = on(
          new Proxy(
            this.config.fields,
            new SelectionProxyHandler({ sqlAliasedBehavior: "sql", sqlBehavior: "sql" })
          )
        );
      }
      if (!this.config.joins) {
        this.config.joins = [];
      }
      this.config.joins.push({ on, table, joinType, alias: tableName, lateral });
      if (typeof tableName === "string") {
        switch (joinType) {
          case "left": {
            this.joinsNotNullableMap[tableName] = false;
            break;
          }
          case "right": {
            this.joinsNotNullableMap = Object.fromEntries(
              Object.entries(this.joinsNotNullableMap).map(([key]) => [key, false])
            );
            this.joinsNotNullableMap[tableName] = true;
            break;
          }
          case "cross":
          case "inner": {
            this.joinsNotNullableMap[tableName] = true;
            break;
          }
          case "full": {
            this.joinsNotNullableMap = Object.fromEntries(
              Object.entries(this.joinsNotNullableMap).map(([key]) => [key, false])
            );
            this.joinsNotNullableMap[tableName] = false;
            break;
          }
        }
      }
      return this;
    };
  }
  /**
   * Executes a `left join` operation by adding another table to the current query.
   *
   * Calling this method associates each row of the table with the corresponding row from the joined table, if a match is found. If no matching row exists, it sets all columns of the joined table to null.
   *
   * See docs: {@link https://orm.drizzle.team/docs/joins#left-join}
   *
   * @param table the table to join.
   * @param on the `on` clause.
   *
   * @example
   *
   * ```ts
   * // Select all users and their pets
   * const usersWithPets: { user: User; pets: Pet | null; }[] = await db.select()
   *   .from(users)
   *   .leftJoin(pets, eq(users.id, pets.ownerId))
   *
   * // Select userId and petId
   * const usersIdsAndPetIds: { userId: number; petId: number | null; }[] = await db.select({
   *   userId: users.id,
   *   petId: pets.id,
   * })
   *   .from(users)
   *   .leftJoin(pets, eq(users.id, pets.ownerId))
   * ```
   */
  leftJoin = this.createJoin("left", false);
  /**
   * Executes a `left join lateral` operation by adding subquery to the current query.
   *
   * A `lateral` join allows the right-hand expression to refer to columns from the left-hand side.
   *
   * Calling this method associates each row of the table with the corresponding row from the joined table, if a match is found. If no matching row exists, it sets all columns of the joined table to null.
   *
   * See docs: {@link https://orm.drizzle.team/docs/joins#left-join-lateral}
   *
   * @param table the subquery to join.
   * @param on the `on` clause.
   */
  leftJoinLateral = this.createJoin("left", true);
  /**
   * Executes a `right join` operation by adding another table to the current query.
   *
   * Calling this method associates each row of the joined table with the corresponding row from the main table, if a match is found. If no matching row exists, it sets all columns of the main table to null.
   *
   * See docs: {@link https://orm.drizzle.team/docs/joins#right-join}
   *
   * @param table the table to join.
   * @param on the `on` clause.
   *
   * @example
   *
   * ```ts
   * // Select all users and their pets
   * const usersWithPets: { user: User | null; pets: Pet; }[] = await db.select()
   *   .from(users)
   *   .rightJoin(pets, eq(users.id, pets.ownerId))
   *
   * // Select userId and petId
   * const usersIdsAndPetIds: { userId: number | null; petId: number; }[] = await db.select({
   *   userId: users.id,
   *   petId: pets.id,
   * })
   *   .from(users)
   *   .rightJoin(pets, eq(users.id, pets.ownerId))
   * ```
   */
  rightJoin = this.createJoin("right", false);
  /**
   * Executes an `inner join` operation, creating a new table by combining rows from two tables that have matching values.
   *
   * Calling this method retrieves rows that have corresponding entries in both joined tables. Rows without matching entries in either table are excluded, resulting in a table that includes only matching pairs.
   *
   * See docs: {@link https://orm.drizzle.team/docs/joins#inner-join}
   *
   * @param table the table to join.
   * @param on the `on` clause.
   *
   * @example
   *
   * ```ts
   * // Select all users and their pets
   * const usersWithPets: { user: User; pets: Pet; }[] = await db.select()
   *   .from(users)
   *   .innerJoin(pets, eq(users.id, pets.ownerId))
   *
   * // Select userId and petId
   * const usersIdsAndPetIds: { userId: number; petId: number; }[] = await db.select({
   *   userId: users.id,
   *   petId: pets.id,
   * })
   *   .from(users)
   *   .innerJoin(pets, eq(users.id, pets.ownerId))
   * ```
   */
  innerJoin = this.createJoin("inner", false);
  /**
   * Executes an `inner join lateral` operation, creating a new table by combining rows from two queries that have matching values.
   *
   * A `lateral` join allows the right-hand expression to refer to columns from the left-hand side.
   *
   * Calling this method retrieves rows that have corresponding entries in both joined tables. Rows without matching entries in either table are excluded, resulting in a table that includes only matching pairs.
   *
   * See docs: {@link https://orm.drizzle.team/docs/joins#inner-join-lateral}
   *
   * @param table the subquery to join.
   * @param on the `on` clause.
   */
  innerJoinLateral = this.createJoin("inner", true);
  /**
   * Executes a `full join` operation by combining rows from two tables into a new table.
   *
   * Calling this method retrieves all rows from both main and joined tables, merging rows with matching values and filling in `null` for non-matching columns.
   *
   * See docs: {@link https://orm.drizzle.team/docs/joins#full-join}
   *
   * @param table the table to join.
   * @param on the `on` clause.
   *
   * @example
   *
   * ```ts
   * // Select all users and their pets
   * const usersWithPets: { user: User | null; pets: Pet | null; }[] = await db.select()
   *   .from(users)
   *   .fullJoin(pets, eq(users.id, pets.ownerId))
   *
   * // Select userId and petId
   * const usersIdsAndPetIds: { userId: number | null; petId: number | null; }[] = await db.select({
   *   userId: users.id,
   *   petId: pets.id,
   * })
   *   .from(users)
   *   .fullJoin(pets, eq(users.id, pets.ownerId))
   * ```
   */
  fullJoin = this.createJoin("full", false);
  /**
   * Executes a `cross join` operation by combining rows from two tables into a new table.
   *
   * Calling this method retrieves all rows from both main and joined tables, merging all rows from each table.
   *
   * See docs: {@link https://orm.drizzle.team/docs/joins#cross-join}
   *
   * @param table the table to join.
   *
   * @example
   *
   * ```ts
   * // Select all users, each user with every pet
   * const usersWithPets: { user: User; pets: Pet; }[] = await db.select()
   *   .from(users)
   *   .crossJoin(pets)
   *
   * // Select userId and petId
   * const usersIdsAndPetIds: { userId: number; petId: number; }[] = await db.select({
   *   userId: users.id,
   *   petId: pets.id,
   * })
   *   .from(users)
   *   .crossJoin(pets)
   * ```
   */
  crossJoin = this.createJoin("cross", false);
  /**
   * Executes a `cross join lateral` operation by combining rows from two queries into a new table.
   *
   * A `lateral` join allows the right-hand expression to refer to columns from the left-hand side.
   *
   * Calling this method retrieves all rows from both main and joined queries, merging all rows from each query.
   *
   * See docs: {@link https://orm.drizzle.team/docs/joins#cross-join-lateral}
   *
   * @param table the query to join.
   */
  crossJoinLateral = this.createJoin("cross", true);
  createSetOperator(type, isAll) {
    return (rightSelection) => {
      const rightSelect = typeof rightSelection === "function" ? rightSelection(getPgSetOperators()) : rightSelection;
      if (!haveSameKeys(this.getSelectedFields(), rightSelect.getSelectedFields())) {
        throw new Error(
          "Set operator error (union / intersect / except): selected fields are not the same or are in a different order"
        );
      }
      this.config.setOperators.push({ type, isAll, rightSelect });
      return this;
    };
  }
  /**
   * Adds `union` set operator to the query.
   *
   * Calling this method will combine the result sets of the `select` statements and remove any duplicate rows that appear across them.
   *
   * See docs: {@link https://orm.drizzle.team/docs/set-operations#union}
   *
   * @example
   *
   * ```ts
   * // Select all unique names from customers and users tables
   * await db.select({ name: users.name })
   *   .from(users)
   *   .union(
   *     db.select({ name: customers.name }).from(customers)
   *   );
   * // or
   * import { union } from 'drizzle-orm/pg-core'
   *
   * await union(
   *   db.select({ name: users.name }).from(users),
   *   db.select({ name: customers.name }).from(customers)
   * );
   * ```
   */
  union = this.createSetOperator("union", false);
  /**
   * Adds `union all` set operator to the query.
   *
   * Calling this method will combine the result-set of the `select` statements and keep all duplicate rows that appear across them.
   *
   * See docs: {@link https://orm.drizzle.team/docs/set-operations#union-all}
   *
   * @example
   *
   * ```ts
   * // Select all transaction ids from both online and in-store sales
   * await db.select({ transaction: onlineSales.transactionId })
   *   .from(onlineSales)
   *   .unionAll(
   *     db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
   *   );
   * // or
   * import { unionAll } from 'drizzle-orm/pg-core'
   *
   * await unionAll(
   *   db.select({ transaction: onlineSales.transactionId }).from(onlineSales),
   *   db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
   * );
   * ```
   */
  unionAll = this.createSetOperator("union", true);
  /**
   * Adds `intersect` set operator to the query.
   *
   * Calling this method will retain only the rows that are present in both result sets and eliminate duplicates.
   *
   * See docs: {@link https://orm.drizzle.team/docs/set-operations#intersect}
   *
   * @example
   *
   * ```ts
   * // Select course names that are offered in both departments A and B
   * await db.select({ courseName: depA.courseName })
   *   .from(depA)
   *   .intersect(
   *     db.select({ courseName: depB.courseName }).from(depB)
   *   );
   * // or
   * import { intersect } from 'drizzle-orm/pg-core'
   *
   * await intersect(
   *   db.select({ courseName: depA.courseName }).from(depA),
   *   db.select({ courseName: depB.courseName }).from(depB)
   * );
   * ```
   */
  intersect = this.createSetOperator("intersect", false);
  /**
   * Adds `intersect all` set operator to the query.
   *
   * Calling this method will retain only the rows that are present in both result sets including all duplicates.
   *
   * See docs: {@link https://orm.drizzle.team/docs/set-operations#intersect-all}
   *
   * @example
   *
   * ```ts
   * // Select all products and quantities that are ordered by both regular and VIP customers
   * await db.select({
   *   productId: regularCustomerOrders.productId,
   *   quantityOrdered: regularCustomerOrders.quantityOrdered
   * })
   * .from(regularCustomerOrders)
   * .intersectAll(
   *   db.select({
   *     productId: vipCustomerOrders.productId,
   *     quantityOrdered: vipCustomerOrders.quantityOrdered
   *   })
   *   .from(vipCustomerOrders)
   * );
   * // or
   * import { intersectAll } from 'drizzle-orm/pg-core'
   *
   * await intersectAll(
   *   db.select({
   *     productId: regularCustomerOrders.productId,
   *     quantityOrdered: regularCustomerOrders.quantityOrdered
   *   })
   *   .from(regularCustomerOrders),
   *   db.select({
   *     productId: vipCustomerOrders.productId,
   *     quantityOrdered: vipCustomerOrders.quantityOrdered
   *   })
   *   .from(vipCustomerOrders)
   * );
   * ```
   */
  intersectAll = this.createSetOperator("intersect", true);
  /**
   * Adds `except` set operator to the query.
   *
   * Calling this method will retrieve all unique rows from the left query, except for the rows that are present in the result set of the right query.
   *
   * See docs: {@link https://orm.drizzle.team/docs/set-operations#except}
   *
   * @example
   *
   * ```ts
   * // Select all courses offered in department A but not in department B
   * await db.select({ courseName: depA.courseName })
   *   .from(depA)
   *   .except(
   *     db.select({ courseName: depB.courseName }).from(depB)
   *   );
   * // or
   * import { except } from 'drizzle-orm/pg-core'
   *
   * await except(
   *   db.select({ courseName: depA.courseName }).from(depA),
   *   db.select({ courseName: depB.courseName }).from(depB)
   * );
   * ```
   */
  except = this.createSetOperator("except", false);
  /**
   * Adds `except all` set operator to the query.
   *
   * Calling this method will retrieve all rows from the left query, except for the rows that are present in the result set of the right query.
   *
   * See docs: {@link https://orm.drizzle.team/docs/set-operations#except-all}
   *
   * @example
   *
   * ```ts
   * // Select all products that are ordered by regular customers but not by VIP customers
   * await db.select({
   *   productId: regularCustomerOrders.productId,
   *   quantityOrdered: regularCustomerOrders.quantityOrdered,
   * })
   * .from(regularCustomerOrders)
   * .exceptAll(
   *   db.select({
   *     productId: vipCustomerOrders.productId,
   *     quantityOrdered: vipCustomerOrders.quantityOrdered,
   *   })
   *   .from(vipCustomerOrders)
   * );
   * // or
   * import { exceptAll } from 'drizzle-orm/pg-core'
   *
   * await exceptAll(
   *   db.select({
   *     productId: regularCustomerOrders.productId,
   *     quantityOrdered: regularCustomerOrders.quantityOrdered
   *   })
   *   .from(regularCustomerOrders),
   *   db.select({
   *     productId: vipCustomerOrders.productId,
   *     quantityOrdered: vipCustomerOrders.quantityOrdered
   *   })
   *   .from(vipCustomerOrders)
   * );
   * ```
   */
  exceptAll = this.createSetOperator("except", true);
  /** @internal */
  addSetOperators(setOperators) {
    this.config.setOperators.push(...setOperators);
    return this;
  }
  /**
   * Adds a `where` clause to the query.
   *
   * Calling this method will select only those rows that fulfill a specified condition.
   *
   * See docs: {@link https://orm.drizzle.team/docs/select#filtering}
   *
   * @param where the `where` clause.
   *
   * @example
   * You can use conditional operators and `sql function` to filter the rows to be selected.
   *
   * ```ts
   * // Select all cars with green color
   * await db.select().from(cars).where(eq(cars.color, 'green'));
   * // or
   * await db.select().from(cars).where(sql`${cars.color} = 'green'`)
   * ```
   *
   * You can logically combine conditional operators with `and()` and `or()` operators:
   *
   * ```ts
   * // Select all BMW cars with a green color
   * await db.select().from(cars).where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
   *
   * // Select all cars with the green or blue color
   * await db.select().from(cars).where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
   * ```
   */
  where(where) {
    if (typeof where === "function") {
      where = where(
        new Proxy(
          this.config.fields,
          new SelectionProxyHandler({ sqlAliasedBehavior: "sql", sqlBehavior: "sql" })
        )
      );
    }
    this.config.where = where;
    return this;
  }
  /**
   * Adds a `having` clause to the query.
   *
   * Calling this method will select only those rows that fulfill a specified condition. It is typically used with aggregate functions to filter the aggregated data based on a specified condition.
   *
   * See docs: {@link https://orm.drizzle.team/docs/select#aggregations}
   *
   * @param having the `having` clause.
   *
   * @example
   *
   * ```ts
   * // Select all brands with more than one car
   * await db.select({
   * 	brand: cars.brand,
   * 	count: sql<number>`cast(count(${cars.id}) as int)`,
   * })
   *   .from(cars)
   *   .groupBy(cars.brand)
   *   .having(({ count }) => gt(count, 1));
   * ```
   */
  having(having) {
    if (typeof having === "function") {
      having = having(
        new Proxy(
          this.config.fields,
          new SelectionProxyHandler({ sqlAliasedBehavior: "sql", sqlBehavior: "sql" })
        )
      );
    }
    this.config.having = having;
    return this;
  }
  groupBy(...columns) {
    if (typeof columns[0] === "function") {
      const groupBy = columns[0](
        new Proxy(
          this.config.fields,
          new SelectionProxyHandler({ sqlAliasedBehavior: "alias", sqlBehavior: "sql" })
        )
      );
      this.config.groupBy = Array.isArray(groupBy) ? groupBy : [groupBy];
    } else {
      this.config.groupBy = columns;
    }
    return this;
  }
  orderBy(...columns) {
    if (typeof columns[0] === "function") {
      const orderBy = columns[0](
        new Proxy(
          this.config.fields,
          new SelectionProxyHandler({ sqlAliasedBehavior: "alias", sqlBehavior: "sql" })
        )
      );
      const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy];
      if (this.config.setOperators.length > 0) {
        this.config.setOperators.at(-1).orderBy = orderByArray;
      } else {
        this.config.orderBy = orderByArray;
      }
    } else {
      const orderByArray = columns;
      if (this.config.setOperators.length > 0) {
        this.config.setOperators.at(-1).orderBy = orderByArray;
      } else {
        this.config.orderBy = orderByArray;
      }
    }
    return this;
  }
  /**
   * Adds a `limit` clause to the query.
   *
   * Calling this method will set the maximum number of rows that will be returned by this query.
   *
   * See docs: {@link https://orm.drizzle.team/docs/select#limit--offset}
   *
   * @param limit the `limit` clause.
   *
   * @example
   *
   * ```ts
   * // Get the first 10 people from this query.
   * await db.select().from(people).limit(10);
   * ```
   */
  limit(limit) {
    if (this.config.setOperators.length > 0) {
      this.config.setOperators.at(-1).limit = limit;
    } else {
      this.config.limit = limit;
    }
    return this;
  }
  /**
   * Adds an `offset` clause to the query.
   *
   * Calling this method will skip a number of rows when returning results from this query.
   *
   * See docs: {@link https://orm.drizzle.team/docs/select#limit--offset}
   *
   * @param offset the `offset` clause.
   *
   * @example
   *
   * ```ts
   * // Get the 10th-20th people from this query.
   * await db.select().from(people).offset(10).limit(10);
   * ```
   */
  offset(offset) {
    if (this.config.setOperators.length > 0) {
      this.config.setOperators.at(-1).offset = offset;
    } else {
      this.config.offset = offset;
    }
    return this;
  }
  /**
   * Adds a `for` clause to the query.
   *
   * Calling this method will specify a lock strength for this query that controls how strictly it acquires exclusive access to the rows being queried.
   *
   * See docs: {@link https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE}
   *
   * @param strength the lock strength.
   * @param config the lock configuration.
   */
  for(strength, config = {}) {
    this.config.lockingClause = { strength, config };
    return this;
  }
  /** @internal */
  getSQL() {
    return this.dialect.buildSelectQuery(this.config);
  }
  toSQL() {
    const { typings: _typings, ...rest } = this.dialect.sqlToQuery(this.getSQL());
    return rest;
  }
  as(alias) {
    const usedTables = [];
    usedTables.push(...extractUsedTable(this.config.table));
    if (this.config.joins) {
      for (const it of this.config.joins) usedTables.push(...extractUsedTable(it.table));
    }
    return new Proxy(
      new Subquery(this.getSQL(), this.config.fields, alias, false, [...new Set(usedTables)]),
      new SelectionProxyHandler({ alias, sqlAliasedBehavior: "alias", sqlBehavior: "error" })
    );
  }
  /** @internal */
  getSelectedFields() {
    return new Proxy(
      this.config.fields,
      new SelectionProxyHandler({ alias: this.tableName, sqlAliasedBehavior: "alias", sqlBehavior: "error" })
    );
  }
  $dynamic() {
    return this;
  }
  $withCache(config) {
    this.cacheConfig = config === void 0 ? { config: {}, enable: true, autoInvalidate: true } : config === false ? { enable: false } : { enable: true, autoInvalidate: true, ...config };
    return this;
  }
};
var PgSelectBase = class extends PgSelectQueryBuilderBase {
  static [entityKind] = "PgSelect";
  /** @internal */
  _prepare(name) {
    const { session, config, dialect, joinsNotNullableMap, authToken, cacheConfig, usedTables } = this;
    if (!session) {
      throw new Error("Cannot execute a query on a query builder. Please use a database instance instead.");
    }
    const { fields } = config;
    return tracer.startActiveSpan("drizzle.prepareQuery", () => {
      const fieldsList = orderSelectedFields(fields);
      const query = session.prepareQuery(dialect.sqlToQuery(this.getSQL()), fieldsList, name, true, void 0, {
        type: "select",
        tables: [...usedTables]
      }, cacheConfig);
      query.joinsNotNullableMap = joinsNotNullableMap;
      return query.setToken(authToken);
    });
  }
  /**
   * Create a prepared statement for this query. This allows
   * the database to remember this query for the given session
   * and call it by name, rather than specifying the full query.
   *
   * {@link https://www.postgresql.org/docs/current/sql-prepare.html | Postgres prepare documentation}
   */
  prepare(name) {
    return this._prepare(name);
  }
  authToken;
  /** @internal */
  setToken(token2) {
    this.authToken = token2;
    return this;
  }
  execute = (placeholderValues) => {
    return tracer.startActiveSpan("drizzle.operation", () => {
      return this._prepare().execute(placeholderValues, this.authToken);
    });
  };
};
applyMixins(PgSelectBase, [QueryPromise]);
function createSetOperator(type, isAll) {
  return (leftSelect, rightSelect, ...restSelects) => {
    const setOperators = [rightSelect, ...restSelects].map((select2) => ({
      type,
      isAll,
      rightSelect: select2
    }));
    for (const setOperator of setOperators) {
      if (!haveSameKeys(leftSelect.getSelectedFields(), setOperator.rightSelect.getSelectedFields())) {
        throw new Error(
          "Set operator error (union / intersect / except): selected fields are not the same or are in a different order"
        );
      }
    }
    return leftSelect.addSetOperators(setOperators);
  };
}
var getPgSetOperators = () => ({
  union,
  unionAll,
  intersect,
  intersectAll,
  except,
  exceptAll
});
var union = createSetOperator("union", false);
var unionAll = createSetOperator("union", true);
var intersect = createSetOperator("intersect", false);
var intersectAll = createSetOperator("intersect", true);
var except = createSetOperator("except", false);
var exceptAll = createSetOperator("except", true);

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/query-builders/query-builder.js
var QueryBuilder = class {
  static [entityKind] = "PgQueryBuilder";
  dialect;
  dialectConfig;
  constructor(dialect) {
    this.dialect = is(dialect, PgDialect) ? dialect : void 0;
    this.dialectConfig = is(dialect, PgDialect) ? void 0 : dialect;
  }
  $with = (alias, selection) => {
    const queryBuilder = this;
    const as = (qb) => {
      if (typeof qb === "function") {
        qb = qb(queryBuilder);
      }
      return new Proxy(
        new WithSubquery(
          qb.getSQL(),
          selection ?? ("getSelectedFields" in qb ? qb.getSelectedFields() ?? {} : {}),
          alias,
          true
        ),
        new SelectionProxyHandler({ alias, sqlAliasedBehavior: "alias", sqlBehavior: "error" })
      );
    };
    return { as };
  };
  with(...queries) {
    const self = this;
    function select2(fields) {
      return new PgSelectBuilder({
        fields: fields ?? void 0,
        session: void 0,
        dialect: self.getDialect(),
        withList: queries
      });
    }
    function selectDistinct(fields) {
      return new PgSelectBuilder({
        fields: fields ?? void 0,
        session: void 0,
        dialect: self.getDialect(),
        distinct: true
      });
    }
    function selectDistinctOn(on, fields) {
      return new PgSelectBuilder({
        fields: fields ?? void 0,
        session: void 0,
        dialect: self.getDialect(),
        distinct: { on }
      });
    }
    return { select: select2, selectDistinct, selectDistinctOn };
  }
  select(fields) {
    return new PgSelectBuilder({
      fields: fields ?? void 0,
      session: void 0,
      dialect: this.getDialect()
    });
  }
  selectDistinct(fields) {
    return new PgSelectBuilder({
      fields: fields ?? void 0,
      session: void 0,
      dialect: this.getDialect(),
      distinct: true
    });
  }
  selectDistinctOn(on, fields) {
    return new PgSelectBuilder({
      fields: fields ?? void 0,
      session: void 0,
      dialect: this.getDialect(),
      distinct: { on }
    });
  }
  // Lazy load dialect to avoid circular dependency
  getDialect() {
    if (!this.dialect) {
      this.dialect = new PgDialect(this.dialectConfig);
    }
    return this.dialect;
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/utils.js
function extractUsedTable(table) {
  if (is(table, PgTable)) {
    return [table[Schema] ? `${table[Schema]}.${table[Table.Symbol.BaseName]}` : table[Table.Symbol.BaseName]];
  }
  if (is(table, Subquery)) {
    return table._.usedTables ?? [];
  }
  if (is(table, SQL)) {
    return table.usedTables ?? [];
  }
  return [];
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/query-builders/delete.js
var PgDeleteBase = class extends QueryPromise {
  constructor(table, session, dialect, withList) {
    super();
    this.session = session;
    this.dialect = dialect;
    this.config = { table, withList };
  }
  static [entityKind] = "PgDelete";
  config;
  cacheConfig;
  /**
   * Adds a `where` clause to the query.
   *
   * Calling this method will delete only those rows that fulfill a specified condition.
   *
   * See docs: {@link https://orm.drizzle.team/docs/delete}
   *
   * @param where the `where` clause.
   *
   * @example
   * You can use conditional operators and `sql function` to filter the rows to be deleted.
   *
   * ```ts
   * // Delete all cars with green color
   * await db.delete(cars).where(eq(cars.color, 'green'));
   * // or
   * await db.delete(cars).where(sql`${cars.color} = 'green'`)
   * ```
   *
   * You can logically combine conditional operators with `and()` and `or()` operators:
   *
   * ```ts
   * // Delete all BMW cars with a green color
   * await db.delete(cars).where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
   *
   * // Delete all cars with the green or blue color
   * await db.delete(cars).where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
   * ```
   */
  where(where) {
    this.config.where = where;
    return this;
  }
  returning(fields = this.config.table[Table.Symbol.Columns]) {
    this.config.returningFields = fields;
    this.config.returning = orderSelectedFields(fields);
    return this;
  }
  /** @internal */
  getSQL() {
    return this.dialect.buildDeleteQuery(this.config);
  }
  toSQL() {
    const { typings: _typings, ...rest } = this.dialect.sqlToQuery(this.getSQL());
    return rest;
  }
  /** @internal */
  _prepare(name) {
    return tracer.startActiveSpan("drizzle.prepareQuery", () => {
      return this.session.prepareQuery(this.dialect.sqlToQuery(this.getSQL()), this.config.returning, name, true, void 0, {
        type: "delete",
        tables: extractUsedTable(this.config.table)
      }, this.cacheConfig);
    });
  }
  prepare(name) {
    return this._prepare(name);
  }
  authToken;
  /** @internal */
  setToken(token2) {
    this.authToken = token2;
    return this;
  }
  execute = (placeholderValues) => {
    return tracer.startActiveSpan("drizzle.operation", () => {
      return this._prepare().execute(placeholderValues, this.authToken);
    });
  };
  /** @internal */
  getSelectedFields() {
    return this.config.returningFields ? new Proxy(
      this.config.returningFields,
      new SelectionProxyHandler({
        alias: getTableName(this.config.table),
        sqlAliasedBehavior: "alias",
        sqlBehavior: "error"
      })
    ) : void 0;
  }
  $dynamic() {
    return this;
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/query-builders/insert.js
var PgInsertBuilder = class {
  constructor(table, session, dialect, withList, overridingSystemValue_) {
    this.table = table;
    this.session = session;
    this.dialect = dialect;
    this.withList = withList;
    this.overridingSystemValue_ = overridingSystemValue_;
  }
  static [entityKind] = "PgInsertBuilder";
  authToken;
  /** @internal */
  setToken(token2) {
    this.authToken = token2;
    return this;
  }
  overridingSystemValue() {
    this.overridingSystemValue_ = true;
    return this;
  }
  values(values2) {
    values2 = Array.isArray(values2) ? values2 : [values2];
    if (values2.length === 0) {
      throw new Error("values() must be called with at least one value");
    }
    const mappedValues = values2.map((entry) => {
      const result = {};
      const cols = this.table[Table.Symbol.Columns];
      for (const colKey of Object.keys(entry)) {
        const colValue = entry[colKey];
        result[colKey] = is(colValue, SQL) ? colValue : new Param(colValue, cols[colKey]);
      }
      return result;
    });
    return new PgInsertBase(
      this.table,
      mappedValues,
      this.session,
      this.dialect,
      this.withList,
      false,
      this.overridingSystemValue_
    ).setToken(this.authToken);
  }
  select(selectQuery) {
    const select2 = typeof selectQuery === "function" ? selectQuery(new QueryBuilder()) : selectQuery;
    if (!is(select2, SQL) && !haveSameKeys(this.table[Columns], select2._.selectedFields)) {
      throw new Error(
        "Insert select error: selected fields are not the same or are in a different order compared to the table definition"
      );
    }
    return new PgInsertBase(this.table, select2, this.session, this.dialect, this.withList, true);
  }
};
var PgInsertBase = class extends QueryPromise {
  constructor(table, values2, session, dialect, withList, select2, overridingSystemValue_) {
    super();
    this.session = session;
    this.dialect = dialect;
    this.config = { table, values: values2, withList, select: select2, overridingSystemValue_ };
  }
  static [entityKind] = "PgInsert";
  config;
  cacheConfig;
  returning(fields = this.config.table[Table.Symbol.Columns]) {
    this.config.returningFields = fields;
    this.config.returning = orderSelectedFields(fields);
    return this;
  }
  /**
   * Adds an `on conflict do nothing` clause to the query.
   *
   * Calling this method simply avoids inserting a row as its alternative action.
   *
   * See docs: {@link https://orm.drizzle.team/docs/insert#on-conflict-do-nothing}
   *
   * @param config The `target` and `where` clauses.
   *
   * @example
   * ```ts
   * // Insert one row and cancel the insert if there's a conflict
   * await db.insert(cars)
   *   .values({ id: 1, brand: 'BMW' })
   *   .onConflictDoNothing();
   *
   * // Explicitly specify conflict target
   * await db.insert(cars)
   *   .values({ id: 1, brand: 'BMW' })
   *   .onConflictDoNothing({ target: cars.id });
   * ```
   */
  onConflictDoNothing(config = {}) {
    if (config.target === void 0) {
      this.config.onConflict = sql`do nothing`;
    } else {
      let targetColumn = "";
      targetColumn = Array.isArray(config.target) ? config.target.map((it) => this.dialect.escapeName(this.dialect.casing.getColumnCasing(it))).join(",") : this.dialect.escapeName(this.dialect.casing.getColumnCasing(config.target));
      const whereSql = config.where ? sql` where ${config.where}` : void 0;
      this.config.onConflict = sql`(${sql.raw(targetColumn)})${whereSql} do nothing`;
    }
    return this;
  }
  /**
   * Adds an `on conflict do update` clause to the query.
   *
   * Calling this method will update the existing row that conflicts with the row proposed for insertion as its alternative action.
   *
   * See docs: {@link https://orm.drizzle.team/docs/insert#upserts-and-conflicts}
   *
   * @param config The `target`, `set` and `where` clauses.
   *
   * @example
   * ```ts
   * // Update the row if there's a conflict
   * await db.insert(cars)
   *   .values({ id: 1, brand: 'BMW' })
   *   .onConflictDoUpdate({
   *     target: cars.id,
   *     set: { brand: 'Porsche' }
   *   });
   *
   * // Upsert with 'where' clause
   * await db.insert(cars)
   *   .values({ id: 1, brand: 'BMW' })
   *   .onConflictDoUpdate({
   *     target: cars.id,
   *     set: { brand: 'newBMW' },
   *     targetWhere: sql`${cars.createdAt} > '2023-01-01'::date`,
   *   });
   * ```
   */
  onConflictDoUpdate(config) {
    if (config.where && (config.targetWhere || config.setWhere)) {
      throw new Error(
        'You cannot use both "where" and "targetWhere"/"setWhere" at the same time - "where" is deprecated, use "targetWhere" or "setWhere" instead.'
      );
    }
    const whereSql = config.where ? sql` where ${config.where}` : void 0;
    const targetWhereSql = config.targetWhere ? sql` where ${config.targetWhere}` : void 0;
    const setWhereSql = config.setWhere ? sql` where ${config.setWhere}` : void 0;
    const setSql = this.dialect.buildUpdateSet(this.config.table, mapUpdateSet(this.config.table, config.set));
    let targetColumn = "";
    targetColumn = Array.isArray(config.target) ? config.target.map((it) => this.dialect.escapeName(this.dialect.casing.getColumnCasing(it))).join(",") : this.dialect.escapeName(this.dialect.casing.getColumnCasing(config.target));
    this.config.onConflict = sql`(${sql.raw(targetColumn)})${targetWhereSql} do update set ${setSql}${whereSql}${setWhereSql}`;
    return this;
  }
  /** @internal */
  getSQL() {
    return this.dialect.buildInsertQuery(this.config);
  }
  toSQL() {
    const { typings: _typings, ...rest } = this.dialect.sqlToQuery(this.getSQL());
    return rest;
  }
  /** @internal */
  _prepare(name) {
    return tracer.startActiveSpan("drizzle.prepareQuery", () => {
      return this.session.prepareQuery(this.dialect.sqlToQuery(this.getSQL()), this.config.returning, name, true, void 0, {
        type: "insert",
        tables: extractUsedTable(this.config.table)
      }, this.cacheConfig);
    });
  }
  prepare(name) {
    return this._prepare(name);
  }
  authToken;
  /** @internal */
  setToken(token2) {
    this.authToken = token2;
    return this;
  }
  execute = (placeholderValues) => {
    return tracer.startActiveSpan("drizzle.operation", () => {
      return this._prepare().execute(placeholderValues, this.authToken);
    });
  };
  /** @internal */
  getSelectedFields() {
    return this.config.returningFields ? new Proxy(
      this.config.returningFields,
      new SelectionProxyHandler({
        alias: getTableName(this.config.table),
        sqlAliasedBehavior: "alias",
        sqlBehavior: "error"
      })
    ) : void 0;
  }
  $dynamic() {
    return this;
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/query-builders/refresh-materialized-view.js
var PgRefreshMaterializedView = class extends QueryPromise {
  constructor(view, session, dialect) {
    super();
    this.session = session;
    this.dialect = dialect;
    this.config = { view };
  }
  static [entityKind] = "PgRefreshMaterializedView";
  config;
  concurrently() {
    if (this.config.withNoData !== void 0) {
      throw new Error("Cannot use concurrently and withNoData together");
    }
    this.config.concurrently = true;
    return this;
  }
  withNoData() {
    if (this.config.concurrently !== void 0) {
      throw new Error("Cannot use concurrently and withNoData together");
    }
    this.config.withNoData = true;
    return this;
  }
  /** @internal */
  getSQL() {
    return this.dialect.buildRefreshMaterializedViewQuery(this.config);
  }
  toSQL() {
    const { typings: _typings, ...rest } = this.dialect.sqlToQuery(this.getSQL());
    return rest;
  }
  /** @internal */
  _prepare(name) {
    return tracer.startActiveSpan("drizzle.prepareQuery", () => {
      return this.session.prepareQuery(this.dialect.sqlToQuery(this.getSQL()), void 0, name, true);
    });
  }
  prepare(name) {
    return this._prepare(name);
  }
  authToken;
  /** @internal */
  setToken(token2) {
    this.authToken = token2;
    return this;
  }
  execute = (placeholderValues) => {
    return tracer.startActiveSpan("drizzle.operation", () => {
      return this._prepare().execute(placeholderValues, this.authToken);
    });
  };
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/query-builders/update.js
var PgUpdateBuilder = class {
  constructor(table, session, dialect, withList) {
    this.table = table;
    this.session = session;
    this.dialect = dialect;
    this.withList = withList;
  }
  static [entityKind] = "PgUpdateBuilder";
  authToken;
  setToken(token2) {
    this.authToken = token2;
    return this;
  }
  set(values2) {
    return new PgUpdateBase(
      this.table,
      mapUpdateSet(this.table, values2),
      this.session,
      this.dialect,
      this.withList
    ).setToken(this.authToken);
  }
};
var PgUpdateBase = class extends QueryPromise {
  constructor(table, set, session, dialect, withList) {
    super();
    this.session = session;
    this.dialect = dialect;
    this.config = { set, table, withList, joins: [] };
    this.tableName = getTableLikeName(table);
    this.joinsNotNullableMap = typeof this.tableName === "string" ? { [this.tableName]: true } : {};
  }
  static [entityKind] = "PgUpdate";
  config;
  tableName;
  joinsNotNullableMap;
  cacheConfig;
  from(source) {
    const src = source;
    const tableName = getTableLikeName(src);
    if (typeof tableName === "string") {
      this.joinsNotNullableMap[tableName] = true;
    }
    this.config.from = src;
    return this;
  }
  getTableLikeFields(table) {
    if (is(table, PgTable)) {
      return table[Table.Symbol.Columns];
    } else if (is(table, Subquery)) {
      return table._.selectedFields;
    }
    return table[ViewBaseConfig].selectedFields;
  }
  createJoin(joinType) {
    return (table, on) => {
      const tableName = getTableLikeName(table);
      if (typeof tableName === "string" && this.config.joins.some((join) => join.alias === tableName)) {
        throw new Error(`Alias "${tableName}" is already used in this query`);
      }
      if (typeof on === "function") {
        const from = this.config.from && !is(this.config.from, SQL) ? this.getTableLikeFields(this.config.from) : void 0;
        on = on(
          new Proxy(
            this.config.table[Table.Symbol.Columns],
            new SelectionProxyHandler({ sqlAliasedBehavior: "sql", sqlBehavior: "sql" })
          ),
          from && new Proxy(
            from,
            new SelectionProxyHandler({ sqlAliasedBehavior: "sql", sqlBehavior: "sql" })
          )
        );
      }
      this.config.joins.push({ on, table, joinType, alias: tableName });
      if (typeof tableName === "string") {
        switch (joinType) {
          case "left": {
            this.joinsNotNullableMap[tableName] = false;
            break;
          }
          case "right": {
            this.joinsNotNullableMap = Object.fromEntries(
              Object.entries(this.joinsNotNullableMap).map(([key]) => [key, false])
            );
            this.joinsNotNullableMap[tableName] = true;
            break;
          }
          case "inner": {
            this.joinsNotNullableMap[tableName] = true;
            break;
          }
          case "full": {
            this.joinsNotNullableMap = Object.fromEntries(
              Object.entries(this.joinsNotNullableMap).map(([key]) => [key, false])
            );
            this.joinsNotNullableMap[tableName] = false;
            break;
          }
        }
      }
      return this;
    };
  }
  leftJoin = this.createJoin("left");
  rightJoin = this.createJoin("right");
  innerJoin = this.createJoin("inner");
  fullJoin = this.createJoin("full");
  /**
   * Adds a 'where' clause to the query.
   *
   * Calling this method will update only those rows that fulfill a specified condition.
   *
   * See docs: {@link https://orm.drizzle.team/docs/update}
   *
   * @param where the 'where' clause.
   *
   * @example
   * You can use conditional operators and `sql function` to filter the rows to be updated.
   *
   * ```ts
   * // Update all cars with green color
   * await db.update(cars).set({ color: 'red' })
   *   .where(eq(cars.color, 'green'));
   * // or
   * await db.update(cars).set({ color: 'red' })
   *   .where(sql`${cars.color} = 'green'`)
   * ```
   *
   * You can logically combine conditional operators with `and()` and `or()` operators:
   *
   * ```ts
   * // Update all BMW cars with a green color
   * await db.update(cars).set({ color: 'red' })
   *   .where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
   *
   * // Update all cars with the green or blue color
   * await db.update(cars).set({ color: 'red' })
   *   .where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
   * ```
   */
  where(where) {
    this.config.where = where;
    return this;
  }
  returning(fields) {
    if (!fields) {
      fields = Object.assign({}, this.config.table[Table.Symbol.Columns]);
      if (this.config.from) {
        const tableName = getTableLikeName(this.config.from);
        if (typeof tableName === "string" && this.config.from && !is(this.config.from, SQL)) {
          const fromFields = this.getTableLikeFields(this.config.from);
          fields[tableName] = fromFields;
        }
        for (const join of this.config.joins) {
          const tableName2 = getTableLikeName(join.table);
          if (typeof tableName2 === "string" && !is(join.table, SQL)) {
            const fromFields = this.getTableLikeFields(join.table);
            fields[tableName2] = fromFields;
          }
        }
      }
    }
    this.config.returningFields = fields;
    this.config.returning = orderSelectedFields(fields);
    return this;
  }
  /** @internal */
  getSQL() {
    return this.dialect.buildUpdateQuery(this.config);
  }
  toSQL() {
    const { typings: _typings, ...rest } = this.dialect.sqlToQuery(this.getSQL());
    return rest;
  }
  /** @internal */
  _prepare(name) {
    const query = this.session.prepareQuery(this.dialect.sqlToQuery(this.getSQL()), this.config.returning, name, true, void 0, {
      type: "insert",
      tables: extractUsedTable(this.config.table)
    }, this.cacheConfig);
    query.joinsNotNullableMap = this.joinsNotNullableMap;
    return query;
  }
  prepare(name) {
    return this._prepare(name);
  }
  authToken;
  /** @internal */
  setToken(token2) {
    this.authToken = token2;
    return this;
  }
  execute = (placeholderValues) => {
    return this._prepare().execute(placeholderValues, this.authToken);
  };
  /** @internal */
  getSelectedFields() {
    return this.config.returningFields ? new Proxy(
      this.config.returningFields,
      new SelectionProxyHandler({
        alias: getTableName(this.config.table),
        sqlAliasedBehavior: "alias",
        sqlBehavior: "error"
      })
    ) : void 0;
  }
  $dynamic() {
    return this;
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/query-builders/count.js
var PgCountBuilder = class _PgCountBuilder extends SQL {
  constructor(params) {
    super(_PgCountBuilder.buildEmbeddedCount(params.source, params.filters).queryChunks);
    this.params = params;
    this.mapWith(Number);
    this.session = params.session;
    this.sql = _PgCountBuilder.buildCount(
      params.source,
      params.filters
    );
  }
  sql;
  token;
  static [entityKind] = "PgCountBuilder";
  [Symbol.toStringTag] = "PgCountBuilder";
  session;
  static buildEmbeddedCount(source, filters) {
    return sql`(select count(*) from ${source}${sql.raw(" where ").if(filters)}${filters})`;
  }
  static buildCount(source, filters) {
    return sql`select count(*) as count from ${source}${sql.raw(" where ").if(filters)}${filters};`;
  }
  /** @intrnal */
  setToken(token2) {
    this.token = token2;
    return this;
  }
  then(onfulfilled, onrejected) {
    return Promise.resolve(this.session.count(this.sql, this.token)).then(
      onfulfilled,
      onrejected
    );
  }
  catch(onRejected) {
    return this.then(void 0, onRejected);
  }
  finally(onFinally) {
    return this.then(
      (value) => {
        onFinally?.();
        return value;
      },
      (reason) => {
        onFinally?.();
        throw reason;
      }
    );
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/query-builders/query.js
var RelationalQueryBuilder = class {
  constructor(fullSchema, schema, tableNamesMap, table, tableConfig, dialect, session) {
    this.fullSchema = fullSchema;
    this.schema = schema;
    this.tableNamesMap = tableNamesMap;
    this.table = table;
    this.tableConfig = tableConfig;
    this.dialect = dialect;
    this.session = session;
  }
  static [entityKind] = "PgRelationalQueryBuilder";
  findMany(config) {
    return new PgRelationalQuery(
      this.fullSchema,
      this.schema,
      this.tableNamesMap,
      this.table,
      this.tableConfig,
      this.dialect,
      this.session,
      config ? config : {},
      "many"
    );
  }
  findFirst(config) {
    return new PgRelationalQuery(
      this.fullSchema,
      this.schema,
      this.tableNamesMap,
      this.table,
      this.tableConfig,
      this.dialect,
      this.session,
      config ? { ...config, limit: 1 } : { limit: 1 },
      "first"
    );
  }
};
var PgRelationalQuery = class extends QueryPromise {
  constructor(fullSchema, schema, tableNamesMap, table, tableConfig, dialect, session, config, mode) {
    super();
    this.fullSchema = fullSchema;
    this.schema = schema;
    this.tableNamesMap = tableNamesMap;
    this.table = table;
    this.tableConfig = tableConfig;
    this.dialect = dialect;
    this.session = session;
    this.config = config;
    this.mode = mode;
  }
  static [entityKind] = "PgRelationalQuery";
  /** @internal */
  _prepare(name) {
    return tracer.startActiveSpan("drizzle.prepareQuery", () => {
      const { query, builtQuery } = this._toSQL();
      return this.session.prepareQuery(
        builtQuery,
        void 0,
        name,
        true,
        (rawRows, mapColumnValue) => {
          const rows = rawRows.map(
            (row) => mapRelationalRow(this.schema, this.tableConfig, row, query.selection, mapColumnValue)
          );
          if (this.mode === "first") {
            return rows[0];
          }
          return rows;
        }
      );
    });
  }
  prepare(name) {
    return this._prepare(name);
  }
  _getQuery() {
    return this.dialect.buildRelationalQueryWithoutPK({
      fullSchema: this.fullSchema,
      schema: this.schema,
      tableNamesMap: this.tableNamesMap,
      table: this.table,
      tableConfig: this.tableConfig,
      queryConfig: this.config,
      tableAlias: this.tableConfig.tsName
    });
  }
  /** @internal */
  getSQL() {
    return this._getQuery().sql;
  }
  _toSQL() {
    const query = this._getQuery();
    const builtQuery = this.dialect.sqlToQuery(query.sql);
    return { query, builtQuery };
  }
  toSQL() {
    return this._toSQL().builtQuery;
  }
  authToken;
  /** @internal */
  setToken(token2) {
    this.authToken = token2;
    return this;
  }
  execute() {
    return tracer.startActiveSpan("drizzle.operation", () => {
      return this._prepare().execute(void 0, this.authToken);
    });
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/query-builders/raw.js
var PgRaw = class extends QueryPromise {
  constructor(execute, sql2, query, mapBatchResult) {
    super();
    this.execute = execute;
    this.sql = sql2;
    this.query = query;
    this.mapBatchResult = mapBatchResult;
  }
  static [entityKind] = "PgRaw";
  /** @internal */
  getSQL() {
    return this.sql;
  }
  getQuery() {
    return this.query;
  }
  mapResult(result, isFromBatch) {
    return isFromBatch ? this.mapBatchResult(result) : result;
  }
  _prepare() {
    return this;
  }
  /** @internal */
  isResponseInArrayMode() {
    return false;
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/db.js
var PgDatabase = class {
  constructor(dialect, session, schema) {
    this.dialect = dialect;
    this.session = session;
    this._ = schema ? {
      schema: schema.schema,
      fullSchema: schema.fullSchema,
      tableNamesMap: schema.tableNamesMap,
      session
    } : {
      schema: void 0,
      fullSchema: {},
      tableNamesMap: {},
      session
    };
    this.query = {};
    if (this._.schema) {
      for (const [tableName, columns] of Object.entries(this._.schema)) {
        this.query[tableName] = new RelationalQueryBuilder(
          schema.fullSchema,
          this._.schema,
          this._.tableNamesMap,
          schema.fullSchema[tableName],
          columns,
          dialect,
          session
        );
      }
    }
    this.$cache = { invalidate: async (_params) => {
    } };
  }
  static [entityKind] = "PgDatabase";
  query;
  /**
   * Creates a subquery that defines a temporary named result set as a CTE.
   *
   * It is useful for breaking down complex queries into simpler parts and for reusing the result set in subsequent parts of the query.
   *
   * See docs: {@link https://orm.drizzle.team/docs/select#with-clause}
   *
   * @param alias The alias for the subquery.
   *
   * Failure to provide an alias will result in a DrizzleTypeError, preventing the subquery from being referenced in other queries.
   *
   * @example
   *
   * ```ts
   * // Create a subquery with alias 'sq' and use it in the select query
   * const sq = db.$with('sq').as(db.select().from(users).where(eq(users.id, 42)));
   *
   * const result = await db.with(sq).select().from(sq);
   * ```
   *
   * To select arbitrary SQL values as fields in a CTE and reference them in other CTEs or in the main query, you need to add aliases to them:
   *
   * ```ts
   * // Select an arbitrary SQL value as a field in a CTE and reference it in the main query
   * const sq = db.$with('sq').as(db.select({
   *   name: sql<string>`upper(${users.name})`.as('name'),
   * })
   * .from(users));
   *
   * const result = await db.with(sq).select({ name: sq.name }).from(sq);
   * ```
   */
  $with = (alias, selection) => {
    const self = this;
    const as = (qb) => {
      if (typeof qb === "function") {
        qb = qb(new QueryBuilder(self.dialect));
      }
      return new Proxy(
        new WithSubquery(
          qb.getSQL(),
          selection ?? ("getSelectedFields" in qb ? qb.getSelectedFields() ?? {} : {}),
          alias,
          true
        ),
        new SelectionProxyHandler({ alias, sqlAliasedBehavior: "alias", sqlBehavior: "error" })
      );
    };
    return { as };
  };
  $count(source, filters) {
    return new PgCountBuilder({ source, filters, session: this.session });
  }
  $cache;
  /**
   * Incorporates a previously defined CTE (using `$with`) into the main query.
   *
   * This method allows the main query to reference a temporary named result set.
   *
   * See docs: {@link https://orm.drizzle.team/docs/select#with-clause}
   *
   * @param queries The CTEs to incorporate into the main query.
   *
   * @example
   *
   * ```ts
   * // Define a subquery 'sq' as a CTE using $with
   * const sq = db.$with('sq').as(db.select().from(users).where(eq(users.id, 42)));
   *
   * // Incorporate the CTE 'sq' into the main query and select from it
   * const result = await db.with(sq).select().from(sq);
   * ```
   */
  with(...queries) {
    const self = this;
    function select2(fields) {
      return new PgSelectBuilder({
        fields: fields ?? void 0,
        session: self.session,
        dialect: self.dialect,
        withList: queries
      });
    }
    function selectDistinct(fields) {
      return new PgSelectBuilder({
        fields: fields ?? void 0,
        session: self.session,
        dialect: self.dialect,
        withList: queries,
        distinct: true
      });
    }
    function selectDistinctOn(on, fields) {
      return new PgSelectBuilder({
        fields: fields ?? void 0,
        session: self.session,
        dialect: self.dialect,
        withList: queries,
        distinct: { on }
      });
    }
    function update(table) {
      return new PgUpdateBuilder(table, self.session, self.dialect, queries);
    }
    function insert(table) {
      return new PgInsertBuilder(table, self.session, self.dialect, queries);
    }
    function delete_(table) {
      return new PgDeleteBase(table, self.session, self.dialect, queries);
    }
    return { select: select2, selectDistinct, selectDistinctOn, update, insert, delete: delete_ };
  }
  select(fields) {
    return new PgSelectBuilder({
      fields: fields ?? void 0,
      session: this.session,
      dialect: this.dialect
    });
  }
  selectDistinct(fields) {
    return new PgSelectBuilder({
      fields: fields ?? void 0,
      session: this.session,
      dialect: this.dialect,
      distinct: true
    });
  }
  selectDistinctOn(on, fields) {
    return new PgSelectBuilder({
      fields: fields ?? void 0,
      session: this.session,
      dialect: this.dialect,
      distinct: { on }
    });
  }
  /**
   * Creates an update query.
   *
   * Calling this method without `.where()` clause will update all rows in a table. The `.where()` clause specifies which rows should be updated.
   *
   * Use `.set()` method to specify which values to update.
   *
   * See docs: {@link https://orm.drizzle.team/docs/update}
   *
   * @param table The table to update.
   *
   * @example
   *
   * ```ts
   * // Update all rows in the 'cars' table
   * await db.update(cars).set({ color: 'red' });
   *
   * // Update rows with filters and conditions
   * await db.update(cars).set({ color: 'red' }).where(eq(cars.brand, 'BMW'));
   *
   * // Update with returning clause
   * const updatedCar: Car[] = await db.update(cars)
   *   .set({ color: 'red' })
   *   .where(eq(cars.id, 1))
   *   .returning();
   * ```
   */
  update(table) {
    return new PgUpdateBuilder(table, this.session, this.dialect);
  }
  /**
   * Creates an insert query.
   *
   * Calling this method will create new rows in a table. Use `.values()` method to specify which values to insert.
   *
   * See docs: {@link https://orm.drizzle.team/docs/insert}
   *
   * @param table The table to insert into.
   *
   * @example
   *
   * ```ts
   * // Insert one row
   * await db.insert(cars).values({ brand: 'BMW' });
   *
   * // Insert multiple rows
   * await db.insert(cars).values([{ brand: 'BMW' }, { brand: 'Porsche' }]);
   *
   * // Insert with returning clause
   * const insertedCar: Car[] = await db.insert(cars)
   *   .values({ brand: 'BMW' })
   *   .returning();
   * ```
   */
  insert(table) {
    return new PgInsertBuilder(table, this.session, this.dialect);
  }
  /**
   * Creates a delete query.
   *
   * Calling this method without `.where()` clause will delete all rows in a table. The `.where()` clause specifies which rows should be deleted.
   *
   * See docs: {@link https://orm.drizzle.team/docs/delete}
   *
   * @param table The table to delete from.
   *
   * @example
   *
   * ```ts
   * // Delete all rows in the 'cars' table
   * await db.delete(cars);
   *
   * // Delete rows with filters and conditions
   * await db.delete(cars).where(eq(cars.color, 'green'));
   *
   * // Delete with returning clause
   * const deletedCar: Car[] = await db.delete(cars)
   *   .where(eq(cars.id, 1))
   *   .returning();
   * ```
   */
  delete(table) {
    return new PgDeleteBase(table, this.session, this.dialect);
  }
  refreshMaterializedView(view) {
    return new PgRefreshMaterializedView(view, this.session, this.dialect);
  }
  authToken;
  execute(query) {
    const sequel = typeof query === "string" ? sql.raw(query) : query.getSQL();
    const builtQuery = this.dialect.sqlToQuery(sequel);
    const prepared = this.session.prepareQuery(
      builtQuery,
      void 0,
      void 0,
      false
    );
    return new PgRaw(
      () => prepared.execute(void 0, this.authToken),
      sequel,
      builtQuery,
      (result) => prepared.mapResult(result, true)
    );
  }
  transaction(transaction, config) {
    return this.session.transaction(transaction, config);
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/cache/core/cache.js
var Cache = class {
  static [entityKind] = "Cache";
};
var NoopCache = class extends Cache {
  strategy() {
    return "all";
  }
  static [entityKind] = "NoopCache";
  async get(_key) {
    return void 0;
  }
  async put(_hashedQuery, _response, _tables, _config) {
  }
  async onMutate(_params) {
  }
};
async function hashQuery(sql2, params) {
  const dataToHash = `${sql2}-${JSON.stringify(params)}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(dataToHash);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = [...new Uint8Array(hashBuffer)];
  const hashHex = hashArray.map((b2) => b2.toString(16).padStart(2, "0")).join("");
  return hashHex;
}

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/pg-core/session.js
var PgPreparedQuery = class {
  constructor(query, cache, queryMetadata, cacheConfig) {
    this.query = query;
    this.cache = cache;
    this.queryMetadata = queryMetadata;
    this.cacheConfig = cacheConfig;
    if (cache && cache.strategy() === "all" && cacheConfig === void 0) {
      this.cacheConfig = { enable: true, autoInvalidate: true };
    }
    if (!this.cacheConfig?.enable) {
      this.cacheConfig = void 0;
    }
  }
  authToken;
  getQuery() {
    return this.query;
  }
  mapResult(response, _isFromBatch) {
    return response;
  }
  /** @internal */
  setToken(token2) {
    this.authToken = token2;
    return this;
  }
  static [entityKind] = "PgPreparedQuery";
  /** @internal */
  joinsNotNullableMap;
  /** @internal */
  async queryWithCache(queryString, params, query) {
    if (this.cache === void 0 || is(this.cache, NoopCache) || this.queryMetadata === void 0) {
      try {
        return await query();
      } catch (e) {
        throw new DrizzleQueryError(queryString, params, e);
      }
    }
    if (this.cacheConfig && !this.cacheConfig.enable) {
      try {
        return await query();
      } catch (e) {
        throw new DrizzleQueryError(queryString, params, e);
      }
    }
    if ((this.queryMetadata.type === "insert" || this.queryMetadata.type === "update" || this.queryMetadata.type === "delete") && this.queryMetadata.tables.length > 0) {
      try {
        const [res] = await Promise.all([
          query(),
          this.cache.onMutate({ tables: this.queryMetadata.tables })
        ]);
        return res;
      } catch (e) {
        throw new DrizzleQueryError(queryString, params, e);
      }
    }
    if (!this.cacheConfig) {
      try {
        return await query();
      } catch (e) {
        throw new DrizzleQueryError(queryString, params, e);
      }
    }
    if (this.queryMetadata.type === "select") {
      const fromCache = await this.cache.get(
        this.cacheConfig.tag ?? await hashQuery(queryString, params),
        this.queryMetadata.tables,
        this.cacheConfig.tag !== void 0,
        this.cacheConfig.autoInvalidate
      );
      if (fromCache === void 0) {
        let result;
        try {
          result = await query();
        } catch (e) {
          throw new DrizzleQueryError(queryString, params, e);
        }
        await this.cache.put(
          this.cacheConfig.tag ?? await hashQuery(queryString, params),
          result,
          // make sure we send tables that were used in a query only if user wants to invalidate it on each write
          this.cacheConfig.autoInvalidate ? this.queryMetadata.tables : [],
          this.cacheConfig.tag !== void 0,
          this.cacheConfig.config
        );
        return result;
      }
      return fromCache;
    }
    try {
      return await query();
    } catch (e) {
      throw new DrizzleQueryError(queryString, params, e);
    }
  }
};
var PgSession = class {
  constructor(dialect) {
    this.dialect = dialect;
  }
  static [entityKind] = "PgSession";
  /** @internal */
  execute(query, token2) {
    return tracer.startActiveSpan("drizzle.operation", () => {
      const prepared = tracer.startActiveSpan("drizzle.prepareQuery", () => {
        return this.prepareQuery(
          this.dialect.sqlToQuery(query),
          void 0,
          void 0,
          false
        );
      });
      return prepared.setToken(token2).execute(void 0, token2);
    });
  }
  all(query) {
    return this.prepareQuery(
      this.dialect.sqlToQuery(query),
      void 0,
      void 0,
      false
    ).all();
  }
  /** @internal */
  async count(sql2, token2) {
    const res = await this.execute(sql2, token2);
    return Number(
      res[0]["count"]
    );
  }
};
var PgTransaction = class extends PgDatabase {
  constructor(dialect, session, schema, nestedIndex = 0) {
    super(dialect, session, schema);
    this.schema = schema;
    this.nestedIndex = nestedIndex;
  }
  static [entityKind] = "PgTransaction";
  rollback() {
    throw new TransactionRollbackError();
  }
  /** @internal */
  getTransactionConfigSQL(config) {
    const chunks = [];
    if (config.isolationLevel) {
      chunks.push(`isolation level ${config.isolationLevel}`);
    }
    if (config.accessMode) {
      chunks.push(config.accessMode);
    }
    if (typeof config.deferrable === "boolean") {
      chunks.push(config.deferrable ? "deferrable" : "not deferrable");
    }
    return sql.raw(chunks.join(" "));
  }
  setTransaction(config) {
    return this.session.execute(sql`set transaction ${this.getTransactionConfigSQL(config)}`);
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/postgres-js/session.js
var PostgresJsPreparedQuery = class extends PgPreparedQuery {
  constructor(client, queryString, params, logger, cache, queryMetadata, cacheConfig, fields, _isResponseInArrayMode, customResultMapper) {
    super({ sql: queryString, params }, cache, queryMetadata, cacheConfig);
    this.client = client;
    this.queryString = queryString;
    this.params = params;
    this.logger = logger;
    this.fields = fields;
    this._isResponseInArrayMode = _isResponseInArrayMode;
    this.customResultMapper = customResultMapper;
  }
  static [entityKind] = "PostgresJsPreparedQuery";
  async execute(placeholderValues = {}) {
    return tracer.startActiveSpan("drizzle.execute", async (span) => {
      const params = fillPlaceholders(this.params, placeholderValues);
      span?.setAttributes({
        "drizzle.query.text": this.queryString,
        "drizzle.query.params": JSON.stringify(params)
      });
      this.logger.logQuery(this.queryString, params);
      const { fields, queryString: query, client, joinsNotNullableMap, customResultMapper } = this;
      if (!fields && !customResultMapper) {
        return tracer.startActiveSpan("drizzle.driver.execute", () => {
          return this.queryWithCache(query, params, async () => {
            return await client.unsafe(query, params);
          });
        });
      }
      const rows = await tracer.startActiveSpan("drizzle.driver.execute", () => {
        span?.setAttributes({
          "drizzle.query.text": query,
          "drizzle.query.params": JSON.stringify(params)
        });
        return this.queryWithCache(query, params, async () => {
          return await client.unsafe(query, params).values();
        });
      });
      return tracer.startActiveSpan("drizzle.mapResponse", () => {
        return customResultMapper ? customResultMapper(rows) : rows.map((row) => mapResultRow(fields, row, joinsNotNullableMap));
      });
    });
  }
  all(placeholderValues = {}) {
    return tracer.startActiveSpan("drizzle.execute", async (span) => {
      const params = fillPlaceholders(this.params, placeholderValues);
      span?.setAttributes({
        "drizzle.query.text": this.queryString,
        "drizzle.query.params": JSON.stringify(params)
      });
      this.logger.logQuery(this.queryString, params);
      return tracer.startActiveSpan("drizzle.driver.execute", () => {
        span?.setAttributes({
          "drizzle.query.text": this.queryString,
          "drizzle.query.params": JSON.stringify(params)
        });
        return this.queryWithCache(this.queryString, params, async () => {
          return this.client.unsafe(this.queryString, params);
        });
      });
    });
  }
  /** @internal */
  isResponseInArrayMode() {
    return this._isResponseInArrayMode;
  }
};
var PostgresJsSession = class _PostgresJsSession extends PgSession {
  constructor(client, dialect, schema, options = {}) {
    super(dialect);
    this.client = client;
    this.schema = schema;
    this.options = options;
    this.logger = options.logger ?? new NoopLogger();
    this.cache = options.cache ?? new NoopCache();
  }
  static [entityKind] = "PostgresJsSession";
  logger;
  cache;
  prepareQuery(query, fields, name, isResponseInArrayMode, customResultMapper, queryMetadata, cacheConfig) {
    return new PostgresJsPreparedQuery(
      this.client,
      query.sql,
      query.params,
      this.logger,
      this.cache,
      queryMetadata,
      cacheConfig,
      fields,
      isResponseInArrayMode,
      customResultMapper
    );
  }
  query(query, params) {
    this.logger.logQuery(query, params);
    return this.client.unsafe(query, params).values();
  }
  queryObjects(query, params) {
    return this.client.unsafe(query, params);
  }
  transaction(transaction, config) {
    return this.client.begin(async (client) => {
      const session = new _PostgresJsSession(
        client,
        this.dialect,
        this.schema,
        this.options
      );
      const tx = new PostgresJsTransaction(this.dialect, session, this.schema);
      if (config) {
        await tx.setTransaction(config);
      }
      return transaction(tx);
    });
  }
};
var PostgresJsTransaction = class _PostgresJsTransaction extends PgTransaction {
  constructor(dialect, session, schema, nestedIndex = 0) {
    super(dialect, session, schema, nestedIndex);
    this.session = session;
  }
  static [entityKind] = "PostgresJsTransaction";
  transaction(transaction) {
    return this.session.client.savepoint((client) => {
      const session = new PostgresJsSession(
        client,
        this.dialect,
        this.schema,
        this.session.options
      );
      const tx = new _PostgresJsTransaction(this.dialect, session, this.schema);
      return transaction(tx);
    });
  }
};

// ../../node_modules/.pnpm/drizzle-orm@0.45.1_@neondatabase+serverless@1.0.1_@opentelemetry+api@1.9.1_@types+pg@8.15.6_postgres@3.4.7/node_modules/drizzle-orm/postgres-js/driver.js
var PostgresJsDatabase = class extends PgDatabase {
  static [entityKind] = "PostgresJsDatabase";
};
function construct(client, config = {}) {
  const transparentParser = (val) => val;
  for (const type of ["1184", "1082", "1083", "1114", "1182", "1185", "1115", "1231"]) {
    client.options.parsers[type] = transparentParser;
    client.options.serializers[type] = transparentParser;
  }
  client.options.serializers["114"] = transparentParser;
  client.options.serializers["3802"] = transparentParser;
  const dialect = new PgDialect({ casing: config.casing });
  let logger;
  if (config.logger === true) {
    logger = new DefaultLogger();
  } else if (config.logger !== false) {
    logger = config.logger;
  }
  let schema;
  if (config.schema) {
    const tablesConfig = extractTablesRelationalConfig(
      config.schema,
      createTableRelationsHelpers
    );
    schema = {
      fullSchema: config.schema,
      schema: tablesConfig.tables,
      tableNamesMap: tablesConfig.tableNamesMap
    };
  }
  const session = new PostgresJsSession(client, dialect, schema, { logger, cache: config.cache });
  const db = new PostgresJsDatabase(dialect, session, schema);
  db.$client = client;
  db.$cache = config.cache;
  if (db.$cache) {
    db.$cache["invalidate"] = config.cache?.onMutate;
  }
  return db;
}
function drizzle(...params) {
  if (typeof params[0] === "string") {
    const instance = src_default(params[0]);
    return construct(instance, params[1]);
  }
  if (isConfig(params[0])) {
    const { connection: connection2, client, ...drizzleConfig } = params[0];
    if (client) return construct(client, drizzleConfig);
    if (typeof connection2 === "object" && connection2.url !== void 0) {
      const { url, ...config } = connection2;
      const instance2 = src_default(url, config);
      return construct(instance2, drizzleConfig);
    }
    const instance = src_default(connection2);
    return construct(instance, drizzleConfig);
  }
  return construct(params[0], params[1]);
}
((drizzle2) => {
  function mock(config) {
    return construct({
      options: {
        parsers: {},
        serializers: {}
      }
    }, config);
  }
  drizzle2.mock = mock;
})(drizzle || (drizzle = {}));

// ../../packages/core/src/db/schema.ts
var schema_exports = {};
__export(schema_exports, {
  category: () => category,
  categoryRelations: () => categoryRelations,
  company: () => company,
  companyEmbeddingCredentials: () => companyEmbeddingCredentials,
  companyRelations: () => companyRelations,
  contentTypeEnum: () => contentTypeEnum,
  dataBackfills: () => dataBackfills,
  document: () => document,
  documentClassEnum: () => documentClassEnum,
  documentContextChunks: () => documentContextChunks,
  documentContextChunksRelations: () => documentContextChunksRelations,
  documentEmbeddings1024: () => documentEmbeddings1024,
  documentEmbeddings768: () => documentEmbeddings768,
  documentMetadata: () => documentMetadata,
  documentMetadataRelations: () => documentMetadataRelations,
  documentPreviews: () => documentPreviews,
  documentPreviewsRelations: () => documentPreviewsRelations,
  documentRetrievalChunks: () => documentRetrievalChunks,
  documentRetrievalChunksRelations: () => documentRetrievalChunksRelations,
  documentSections: () => documentSections,
  documentSectionsRelations: () => documentSectionsRelations,
  documentStructure: () => documentStructure,
  documentStructureRelations: () => documentStructureRelations,
  documentVersions: () => documentVersions,
  documentVersionsRelations: () => documentVersionsRelations,
  documentsRelations: () => documentsRelations,
  entityLabelEnum: () => entityLabelEnum,
  experimentalDocumentEmbeddings: () => experimentalDocumentEmbeddings,
  fileUploads: () => fileUploads,
  kgEntities: () => kgEntities,
  kgEntitiesRelations: () => kgEntitiesRelations,
  kgEntityMentions: () => kgEntityMentions,
  kgEntityMentionsRelations: () => kgEntityMentionsRelations,
  kgRelationships: () => kgRelationships,
  kgRelationshipsRelations: () => kgRelationshipsRelations,
  ocrCostTracking: () => ocrCostTracking,
  ocrCostTrackingRelations: () => ocrCostTrackingRelations,
  ocrJobs: () => ocrJobs,
  ocrJobsRelations: () => ocrJobsRelations,
  ocrProcessingSteps: () => ocrProcessingSteps,
  ocrProcessingStepsRelations: () => ocrProcessingStepsRelations,
  pdfChunks: () => pdfChunks,
  pdfChunksRelations: () => pdfChunksRelations,
  pgTable: () => pgTable,
  previewTypeEnum: () => previewTypeEnum,
  relationshipTypeEnum: () => relationshipTypeEnum,
  resultTypeEnum: () => resultTypeEnum,
  semanticTypeEnum: () => semanticTypeEnum,
  uploadBatchFiles: () => uploadBatchFiles,
  uploadBatchFilesRelations: () => uploadBatchFilesRelations,
  uploadBatches: () => uploadBatches,
  uploadBatchesRelations: () => uploadBatchesRelations,
  workspaceResults: () => workspaceResults,
  workspaceResultsRelations: () => workspaceResultsRelations,
  workspaceStatusEnum: () => workspaceStatusEnum
});

// ../../packages/core/src/db/schema/helpers.ts
var pgTable = pgTableCreator((name) => `pdr_ai_v2_${name}`);

// ../../packages/core/src/db/schema/base.ts
var company = pgTable("company", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: varchar("name", { length: 256 }).notNull(),
  slug: varchar("slug", { length: 64 }),
  description: text("description"),
  industry: varchar("industry", { length: 256 }),
  swatch: integer("swatch").default(1).notNull(),
  // Legacy column; kept in sync with activeEmbeddingIndexKey via
  // updateCompany during the migration window. Drop after callers migrate.
  embeddingIndexKey: varchar("embedding_index_key", { length: 128 }),
  // SearchSettings-style lifecycle. `active` is what ingest/query use;
  // `pending` is the target of an in-progress reindex.
  activeEmbeddingIndexKey: varchar("active_embedding_index_key", { length: 128 }),
  pendingEmbeddingIndexKey: varchar("pending_embedding_index_key", { length: 128 }),
  reindexStatus: varchar("reindex_status", { length: 16 }).notNull().default("STABLE"),
  reindexJobId: text("reindex_job_id"),
  reindexStartedAt: timestamp("reindex_started_at", { withTimezone: true }),
  reindexCompletedAt: timestamp("reindex_completed_at", { withTimezone: true }),
  reindexError: text("reindex_error"),
  // Embedding provider credentials live in `company_embedding_credentials`,
  // encrypted. See src/embeddings/company-credentials.ts.
  employerpasskey: varchar("employerPasskey", { length: 256 }).notNull().default(""),
  employeepasskey: varchar("employeePasskey", { length: 256 }).notNull().default(""),
  numberOfEmployees: varchar("numberOfEmployees", { length: 256 }).notNull(),
  useUploadThing: boolean("use_uploadthing").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
    () => /* @__PURE__ */ new Date()
  )
});
var document = pgTable(
  "document",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    url: varchar("url", { length: 256 }).notNull(),
    category: varchar("category", { length: 256 }).notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    companyId: bigint("company_id", { mode: "bigint" }).notNull().references(() => company.id, { onDelete: "cascade" }),
    ocrEnabled: boolean("ocr_enabled").default(false),
    ocrProcessed: boolean("ocr_processed").default(false),
    ocrMetadata: jsonb("ocr_metadata"),
    // New OCR fields
    ocrJobId: varchar("ocr_job_id", { length: 256 }),
    ocrProvider: varchar("ocr_provider", { length: 50 }),
    ocrConfidenceScore: integer("ocr_confidence_score"),
    ocrCostCents: integer("ocr_cost_cents"),
    mimeType: varchar("mime_type", { length: 128 }),
    sourceArchiveName: varchar("source_archive_name", { length: 256 }),
    fileType: varchar("file_type", { length: 128 }),
    currentVersionId: bigint("current_version_id", { mode: "bigint" }),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => /* @__PURE__ */ new Date()
    )
  },
  (table) => ({
    companyIdIdx: index("document_company_id_idx").on(table.companyId),
    companyIdIdIdx: index("document_company_id_id_idx").on(table.companyId, table.id),
    companyIdCategoryIdx: index("document_company_id_category_idx").on(
      table.companyId,
      table.category
    ),
    currentVersionIdIdx: index("document_current_version_id_idx").on(
      table.currentVersionId
    )
  })
);
var documentVersions = pgTable(
  "document_versions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    documentId: bigint("document_id", { mode: "bigint" }).notNull().references(() => document.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    url: varchar("url", { length: 512 }).notNull(),
    mimeType: varchar("mime_type", { length: 128 }).notNull(),
    fileSize: bigint("file_size", { mode: "bigint" }),
    uploadedBy: varchar("uploaded_by", { length: 256 }),
    changelog: text("changelog"),
    ocrJobId: varchar("ocr_job_id", { length: 256 }),
    ocrProvider: varchar("ocr_provider", { length: 50 }),
    ocrProcessed: boolean("ocr_processed").default(false),
    ocrMetadata: jsonb("ocr_metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    documentIdIdx: index("doc_versions_document_id_idx").on(table.documentId),
    documentVersionUnique: uniqueIndex("doc_versions_document_version_unique").on(
      table.documentId,
      table.versionNumber
    )
  })
);
var category = pgTable(
  "category",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    name: varchar("name", { length: 256 }).notNull(),
    companyId: bigint("company_id", { mode: "bigint" }).notNull().references(() => company.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => /* @__PURE__ */ new Date()
    )
  },
  (table) => ({
    companyIdIdx: index("category_company_id_idx").on(table.companyId)
  })
);
var pdfChunks = pgTable(
  "pdf_chunks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    documentId: bigint("document_id", { mode: "bigint" }).notNull().references(() => document.id, { onDelete: "cascade" }),
    page: integer("page").notNull(),
    chunkIndex: integer("chunk_index").notNull().default(0),
    // deterministic ordering within a page
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 })
  },
  (table) => ({
    documentIdIdx: index("pdf_chunks_document_id_idx").on(table.documentId),
    documentIdPageIdx: index("pdf_chunks_document_id_page_idx").on(
      table.documentId,
      table.page
    ),
    documentIdPageChunkIdx: index("pdf_chunks_document_id_page_chunk_idx").on(
      table.documentId,
      table.page,
      table.chunkIndex
    )
  })
);
var fileUploads = pgTable(
  "file_uploads",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: varchar("user_id", { length: 256 }).notNull(),
    filename: varchar("filename", { length: 256 }).notNull(),
    mimeType: varchar("mime_type", { length: 128 }).notNull(),
    fileData: text("file_data"),
    fileSize: integer("file_size").notNull(),
    storageProvider: varchar("storage_provider", { length: 64 }).default("database").notNull(),
    storageUrl: varchar("storage_url", { length: 1024 }),
    storagePathname: varchar("storage_pathname", { length: 1024 }),
    blobChecksum: varchar("blob_checksum", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    userIdIdx: index("file_uploads_user_id_idx").on(table.userId)
  })
);
var ocrJobs = pgTable(
  "ocr_jobs",
  {
    id: varchar("id", { length: 256 }).primaryKey(),
    documentId: bigint("document_id", { mode: "bigint" }).references(() => document.id, { onDelete: "set null" }),
    companyId: bigint("company_id", { mode: "bigint" }).notNull().references(() => company.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 256 }).notNull(),
    // Status
    status: varchar("status", {
      length: 50,
      enum: ["queued", "processing", "completed", "failed", "needs_review"]
    }).notNull().default("queued"),
    // Document info
    documentUrl: varchar("document_url", { length: 1024 }).notNull(),
    documentName: varchar("document_name", { length: 256 }).notNull(),
    pageCount: integer("page_count"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "bigint" }),
    // Pre-assessment
    complexityScore: integer("complexity_score"),
    documentType: varchar("document_type", {
      length: 50,
      enum: ["contract", "financial", "scanned", "general", "other"]
    }),
    // Provider selection
    primaryProvider: varchar("primary_provider", { length: 50 }),
    actualProvider: varchar("actual_provider", { length: 50 }),
    // Cost tracking
    estimatedCostCents: integer("estimated_cost_cents"),
    actualCostCents: integer("actual_cost_cents"),
    // Quality metrics
    confidenceScore: integer("confidence_score"),
    qualityFlags: jsonb("quality_flags").$type(),
    requiresReview: boolean("requires_review").default(false),
    // Timing
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    processingDurationMs: integer("processing_duration_ms"),
    // Results
    ocrResult: jsonb("ocr_result"),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").default(0),
    // Webhook
    webhookUrl: varchar("webhook_url", { length: 1024 }),
    webhookStatus: varchar("webhook_status", {
      length: 20,
      enum: ["pending", "sent", "failed"]
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => /* @__PURE__ */ new Date()
    )
  },
  (table) => ({
    companyIdIdx: index("ocr_jobs_company_id_idx").on(table.companyId),
    userIdIdx: index("ocr_jobs_user_id_idx").on(table.userId),
    statusIdx: index("ocr_jobs_status_idx").on(table.status),
    createdAtIdx: index("ocr_jobs_created_at_idx").on(table.createdAt),
    companyStatusIdx: index("ocr_jobs_company_status_idx").on(table.companyId, table.status)
  })
);
var ocrProcessingSteps = pgTable(
  "ocr_processing_steps",
  {
    id: varchar("id", { length: 256 }).primaryKey(),
    jobId: varchar("job_id", { length: 256 }).notNull().references(() => ocrJobs.id, { onDelete: "cascade" }),
    stepNumber: integer("step_number").notNull(),
    stepType: varchar("step_type", {
      length: 50,
      enum: ["pre_assessment", "ocr_execution", "validation", "embedding", "storage", "webhook"]
    }).notNull(),
    status: varchar("status", {
      length: 20,
      enum: ["pending", "in_progress", "completed", "failed"]
    }).notNull().default("pending"),
    input: jsonb("input"),
    output: jsonb("output"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    jobIdIdx: index("ocr_processing_steps_job_id_idx").on(table.jobId),
    jobIdStepIdx: index("ocr_processing_steps_job_id_step_idx").on(table.jobId, table.stepNumber)
  })
);
var ocrCostTracking = pgTable(
  "ocr_cost_tracking",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    companyId: bigint("company_id", { mode: "bigint" }).notNull().references(() => company.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 50 }).notNull(),
    month: varchar("month", { length: 7 }).notNull(),
    // YYYY-MM format
    totalJobs: integer("total_jobs").default(0).notNull(),
    totalPages: integer("total_pages").default(0).notNull(),
    totalCostCents: integer("total_cost_cents").default(0).notNull(),
    averageCostPerPage: integer("average_cost_per_page").default(0).notNull(),
    averageConfidenceScore: integer("average_confidence_score").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => /* @__PURE__ */ new Date()
    )
  },
  (table) => ({
    companyProviderMonthIdx: index("ocr_cost_tracking_company_provider_month_idx").on(
      table.companyId,
      table.provider,
      table.month
    )
  })
);
var uploadBatches = pgTable(
  "upload_batches",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    companyId: bigint("company_id", { mode: "bigint" }).notNull().references(() => company.id, { onDelete: "cascade" }),
    createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
    status: varchar("status", {
      length: 32,
      enum: ["created", "uploading", "committed", "processing", "complete", "failed"]
    }).notNull().default("created"),
    metadata: jsonb("metadata"),
    totalFiles: integer("total_files").default(0).notNull(),
    uploadedFiles: integer("uploaded_files").default(0).notNull(),
    processedFiles: integer("processed_files").default(0).notNull(),
    failedFiles: integer("failed_files").default(0).notNull(),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => /* @__PURE__ */ new Date()
    )
  },
  (table) => ({
    companyIdx: index("upload_batches_company_idx").on(table.companyId),
    creatorIdx: index("upload_batches_creator_idx").on(table.createdByUserId),
    statusIdx: index("upload_batches_status_idx").on(table.status)
  })
);
var uploadBatchFiles = pgTable(
  "upload_batch_files",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    batchId: varchar("batch_id", { length: 64 }).notNull().references(() => uploadBatches.id, { onDelete: "cascade" }),
    companyId: bigint("company_id", { mode: "bigint" }).notNull().references(() => company.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 256 }).notNull(),
    filename: varchar("filename", { length: 512 }).notNull(),
    relativePath: varchar("relative_path", { length: 1024 }),
    mimeType: varchar("mime_type", { length: 128 }),
    fileSizeBytes: bigint("file_size_bytes", { mode: "bigint" }),
    storageUrl: varchar("storage_url", { length: 1024 }),
    storageType: varchar("storage_type", { length: 32 }),
    status: varchar("status", {
      length: 32,
      enum: ["queued", "uploaded", "processing", "complete", "failed"]
    }).notNull().default("queued"),
    metadata: jsonb("metadata"),
    documentId: bigint("document_id", { mode: "bigint" }).references(() => document.id, {
      onDelete: "set null"
    }),
    jobId: varchar("job_id", { length: 256 }).references(() => ocrJobs.id, {
      onDelete: "set null"
    }),
    errorMessage: text("error_message"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => /* @__PURE__ */ new Date()
    )
  },
  (table) => ({
    batchIdx: index("upload_batch_files_batch_idx").on(table.batchId),
    statusIdx: index("upload_batch_files_status_idx").on(table.status),
    jobIdx: index("upload_batch_files_job_idx").on(table.jobId),
    documentIdx: index("upload_batch_files_document_idx").on(table.documentId)
  })
);
var uploadBatchesRelations = relations(uploadBatches, ({ many, one }) => ({
  files: many(uploadBatchFiles),
  company: one(company, {
    fields: [uploadBatches.companyId],
    references: [company.id]
  })
}));
var uploadBatchFilesRelations = relations(uploadBatchFiles, ({ one }) => ({
  batch: one(uploadBatches, {
    fields: [uploadBatchFiles.batchId],
    references: [uploadBatches.id]
  }),
  document: one(document, {
    fields: [uploadBatchFiles.documentId],
    references: [document.id]
  }),
  job: one(ocrJobs, {
    fields: [uploadBatchFiles.jobId],
    references: [ocrJobs.id]
  })
}));
var companyRelations = relations(company, ({ many }) => ({
  documents: many(document),
  categories: many(category)
}));
var documentsRelations = relations(document, ({ one, many }) => ({
  company: one(company, {
    fields: [document.companyId],
    references: [company.id]
  }),
  pdfChunks: many(pdfChunks),
  versions: many(documentVersions),
  currentVersion: one(documentVersions, {
    fields: [document.currentVersionId],
    references: [documentVersions.id],
    relationName: "document_current_version"
  })
}));
var documentVersionsRelations = relations(documentVersions, ({ one }) => ({
  document: one(document, {
    fields: [documentVersions.documentId],
    references: [document.id]
  })
}));
var categoryRelations = relations(category, ({ one }) => ({
  company: one(company, {
    fields: [category.companyId],
    references: [company.id]
  })
}));
var pdfChunksRelations = relations(pdfChunks, ({ one }) => ({
  document: one(document, {
    fields: [pdfChunks.documentId],
    references: [document.id]
  })
}));
var ocrJobsRelations = relations(ocrJobs, ({ one, many }) => ({
  company: one(company, {
    fields: [ocrJobs.companyId],
    references: [company.id]
  }),
  document: one(document, {
    fields: [ocrJobs.documentId],
    references: [document.id]
  }),
  processingSteps: many(ocrProcessingSteps)
}));
var ocrProcessingStepsRelations = relations(ocrProcessingSteps, ({ one }) => ({
  job: one(ocrJobs, {
    fields: [ocrProcessingSteps.jobId],
    references: [ocrJobs.id]
  })
}));
var ocrCostTrackingRelations = relations(ocrCostTracking, ({ one }) => ({
  company: one(company, {
    fields: [ocrCostTracking.companyId],
    references: [company.id]
  })
}));

// ../../packages/core/src/db/schema/company-credentials.ts
var companyEmbeddingCredentials = pgTable(
  "company_embedding_credentials",
  {
    companyId: bigint("company_id", { mode: "number" }).primaryKey().references(() => company.id, { onDelete: "cascade" }),
    openAIApiKeyCiphertext: text("openai_api_key_ciphertext"),
    openAIApiKeyLast4: varchar("openai_api_key_last4", { length: 8 }),
    huggingFaceApiKeyCiphertext: text("huggingface_api_key_ciphertext"),
    huggingFaceApiKeyLast4: varchar("huggingface_api_key_last4", { length: 8 }),
    ollamaBaseUrl: text("ollama_base_url"),
    ollamaModel: varchar("ollama_model", { length: 256 }),
    encryptionKeyVersion: smallint("encryption_key_version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull()
  }
);

// ../../packages/core/src/db/schema/rlm-knowledge-base.ts
var contentTypeEnum = [
  "section",
  "table",
  "figure",
  "list",
  "paragraph",
  "appendix",
  "header",
  "footer"
];
var semanticTypeEnum = [
  "narrative",
  "procedural",
  "tabular",
  "legal",
  "financial",
  "technical",
  "reference"
];
var documentClassEnum = [
  "contract",
  "policy",
  "compliance",
  "hr",
  "financial",
  "technical",
  "manual",
  "report",
  "other"
];
var previewTypeEnum = [
  "summary",
  "outline",
  "keywords",
  "key_points",
  "abstract",
  "first_paragraph"
];
var resultTypeEnum = [
  "extraction",
  "summary",
  "analysis",
  "reasoning_step",
  "checkpoint",
  "verification",
  "sub_query"
];
var workspaceStatusEnum = [
  "pending",
  "processing",
  "completed",
  "failed",
  "expired"
];
var documentStructure = pgTable(
  "document_structure",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    documentId: bigint("document_id", { mode: "bigint" }).notNull().references(() => document.id, { onDelete: "cascade" }),
    // Versioning: which version of the document this structure node belongs to.
    // Nullable during Phase 1 rollout; backfilled to the v1 row for existing documents.
    // Deleting a version cascades and removes its structure nodes.
    versionId: bigint("version_id", { mode: "bigint" }).references(
      () => documentVersions.id,
      { onDelete: "cascade" }
    ),
    parentId: bigint("parent_id", { mode: "bigint" }),
    // Self-reference, null for root
    level: integer("level").notNull().default(0),
    // Depth: 0=root, 1=section, 2+=subsection
    ordering: integer("ordering").notNull().default(0),
    // Sibling order for traversal
    title: text("title"),
    // Section heading (nullable for content-only nodes)
    contentType: varchar("content_type", {
      length: 50,
      enum: contentTypeEnum
    }).notNull().default("section"),
    path: varchar("path", { length: 256 }),
    // Tree path (e.g., "1.2.3")
    startPage: integer("start_page"),
    endPage: integer("end_page"),
    childCount: integer("child_count").notNull().default(0),
    // Token count for this node only (excluding children)
    tokenCount: integer("token_count").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => /* @__PURE__ */ new Date()
    )
  },
  (table) => ({
    documentIdIdx: index("doc_structure_document_id_idx").on(table.documentId),
    parentIdIdx: index("doc_structure_parent_id_idx").on(table.parentId),
    documentLevelIdx: index("doc_structure_document_level_idx").on(
      table.documentId,
      table.level
    ),
    documentPathIdx: index("doc_structure_document_path_idx").on(
      table.documentId,
      table.path
    ),
    documentOrderingIdx: index("doc_structure_document_ordering_idx").on(
      table.documentId,
      table.parentId,
      table.ordering
    ),
    versionIdIdx: index("doc_structure_version_id_idx").on(table.versionId)
  })
);
var documentContextChunks = pgTable(
  "document_context_chunks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    documentId: bigint("document_id", { mode: "bigint" }).notNull().references(() => document.id, { onDelete: "cascade" }),
    // Versioning: which version of the document this chunk belongs to.
    // Nullable during Phase 1 rollout; backfilled to the v1 row for existing documents.
    versionId: bigint("version_id", { mode: "bigint" }).references(
      () => documentVersions.id,
      { onDelete: "cascade" }
    ),
    structureId: bigint("structure_id", { mode: "bigint" }).references(
      () => documentStructure.id,
      { onDelete: "cascade" }
    ),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    // For cost estimation
    charCount: integer("char_count").notNull().default(0),
    // Optional embedding for the parent chunk (can be used for coarse retrieval)
    embedding: vector("embedding", { dimensions: 1536 }),
    contentHash: varchar("content_hash", { length: 64 }),
    // SHA-256 for deduplication
    semanticType: varchar("semantic_type", {
      length: 50,
      enum: semanticTypeEnum
    }),
    pageNumber: integer("page_number"),
    // Additional metadata for fine-grained access
    lineStart: integer("line_start"),
    lineEnd: integer("line_end"),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => /* @__PURE__ */ new Date()
    )
  },
  (table) => ({
    documentIdIdx: index("doc_ctx_chunks_document_id_idx").on(table.documentId),
    structureIdIdx: index("doc_ctx_chunks_structure_id_idx").on(table.structureId),
    documentPageIdx: index("doc_ctx_chunks_document_page_idx").on(
      table.documentId,
      table.pageNumber
    ),
    contentHashIdx: index("doc_ctx_chunks_content_hash_idx").on(table.contentHash),
    semanticTypeIdx: index("doc_ctx_chunks_semantic_type_idx").on(
      table.documentId,
      table.semanticType
    ),
    versionIdIdx: index("doc_ctx_chunks_version_id_idx").on(table.versionId)
  })
);
var documentRetrievalChunks = pgTable(
  "document_retrieval_chunks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    contextChunkId: bigint("context_chunk_id", { mode: "bigint" }).notNull().references(() => documentContextChunks.id, { onDelete: "cascade" }),
    documentId: bigint("document_id", { mode: "bigint" }).notNull().references(() => document.id, { onDelete: "cascade" }),
    // Versioning: which version of the document this retrieval chunk belongs to.
    // Nullable during Phase 1 rollout; backfilled to the v1 row for existing documents.
    versionId: bigint("version_id", { mode: "bigint" }).references(
      () => documentVersions.id,
      { onDelete: "cascade" }
    ),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    // Full dimension embedding (storage)
    embedding: vector("embedding", { dimensions: 1536 }),
    // Matryoshka optimization: Index only the first 512 dimensions for speed
    embeddingShort: vector("embedding_short", { dimensions: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    contextChunkIdIdx: index("doc_ret_chunks_context_chunk_id_idx").on(table.contextChunkId),
    documentIdIdx: index("doc_ret_chunks_document_id_idx").on(table.documentId),
    // Index on the short embedding for fast ANN search.
    // m/ef_construction are pgvector's defaults, stated explicitly so the
    // generated DDL is stable rather than depending on server defaults.
    embeddingShortIdx: index("doc_ret_chunks_embedding_short_idx").using("hnsw", table.embeddingShort.op("vector_cosine_ops")).with({ m: 16, ef_construction: 64 }),
    versionIdIdx: index("doc_ret_chunks_version_id_idx").on(table.versionId)
  })
);
var experimentalDocumentEmbeddings = pgTable(
  "document_embeddings_exp",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    documentId: bigint("document_id", { mode: "bigint" }).notNull().references(() => document.id, { onDelete: "cascade" }),
    retrievalChunkId: bigint("retrieval_chunk_id", { mode: "bigint" }).notNull().references(() => documentRetrievalChunks.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    version: text("version").notNull(),
    dimension: integer("dimension").notNull().default(1024),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    documentProviderIdx: index("document_embeddings_exp_doc_idx").on(
      table.documentId,
      table.provider,
      table.model,
      table.version
    ),
    chunkIdx: index("document_embeddings_exp_chunk_idx").on(
      table.retrievalChunkId
    ),
    chunkProviderUnique: uniqueIndex(
      "document_embeddings_exp_chunk_unique"
    ).on(table.retrievalChunkId, table.provider, table.model, table.version)
  })
);
var documentEmbeddings768 = pgTable(
  "document_embeddings_768",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    documentId: bigint("document_id", { mode: "bigint" }).notNull().references(() => document.id, { onDelete: "cascade" }),
    retrievalChunkId: bigint("retrieval_chunk_id", { mode: "bigint" }).notNull().references(() => documentRetrievalChunks.id, { onDelete: "cascade" }),
    indexKey: varchar("index_key", { length: 128 }).notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    version: text("version").notNull(),
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    documentIndexIdx: index("document_embeddings_768_doc_idx").on(
      table.documentId,
      table.indexKey
    ),
    chunkIdx: index("document_embeddings_768_chunk_idx").on(
      table.retrievalChunkId
    ),
    chunkIndexUnique: uniqueIndex("document_embeddings_768_chunk_unique").on(
      table.retrievalChunkId,
      table.indexKey
    ),
    embeddingHnswIdx: index("document_embeddings_768_embedding_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")).with({ m: 16, ef_construction: 64 })
  })
);
var documentEmbeddings1024 = pgTable(
  "document_embeddings_1024",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    documentId: bigint("document_id", { mode: "bigint" }).notNull().references(() => document.id, { onDelete: "cascade" }),
    retrievalChunkId: bigint("retrieval_chunk_id", { mode: "bigint" }).notNull().references(() => documentRetrievalChunks.id, { onDelete: "cascade" }),
    indexKey: varchar("index_key", { length: 128 }).notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    version: text("version").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    documentIndexIdx: index("document_embeddings_1024_doc_idx").on(
      table.documentId,
      table.indexKey
    ),
    chunkIdx: index("document_embeddings_1024_chunk_idx").on(
      table.retrievalChunkId
    ),
    chunkIndexUnique: uniqueIndex("document_embeddings_1024_chunk_unique").on(
      table.retrievalChunkId,
      table.indexKey
    ),
    embeddingHnswIdx: index("document_embeddings_1024_embedding_hnsw_idx").using("hnsw", table.embedding.op("vector_cosine_ops")).with({ m: 16, ef_construction: 64 })
  })
);
var documentMetadata = pgTable(
  "document_metadata",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    documentId: bigint("document_id", { mode: "bigint" }).notNull().references(() => document.id, { onDelete: "cascade" }),
    // Versioning: which version of the document this metadata belongs to.
    // Nullable during Phase 1 rollout; backfilled to the v1 row for existing documents.
    versionId: bigint("version_id", { mode: "bigint" }).references(
      () => documentVersions.id,
      { onDelete: "cascade" }
    ),
    // Token/size metrics for cost-aware planning
    totalTokens: integer("total_tokens").default(0),
    totalSections: integer("total_sections").default(0),
    totalTables: integer("total_tables").default(0),
    totalFigures: integer("total_figures").default(0),
    totalPages: integer("total_pages").default(0),
    maxSectionDepth: integer("max_section_depth").default(0),
    // Semantic metadata
    topicTags: jsonb("topic_tags").$type(),
    summary: text("summary"),
    // AI-generated summary
    outline: jsonb("outline").$type(),
    // Document TOC structure
    // Classification
    complexityScore: integer("complexity_score"),
    // 0-100 complexity rating
    documentClass: varchar("document_class", {
      length: 50,
      enum: documentClassEnum
    }),
    // Extracted entities for quick filtering
    entities: jsonb("entities").$type(),
    // Document-level embedding for similarity
    summaryEmbedding: vector("summary_embedding", { dimensions: 1536 }),
    // Date range covered in document (for temporal queries)
    dateRangeStart: timestamp("date_range_start", { withTimezone: true }),
    dateRangeEnd: timestamp("date_range_end", { withTimezone: true }),
    // Language and formatting
    language: varchar("language", { length: 10 }).default("en"),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => /* @__PURE__ */ new Date()
    )
  },
  (table) => ({
    // Prior to versioning, metadata was a single row per document.
    // With versioning, each version of a document gets its own metadata
    // row (summary, token count, complexity, etc. are computed per-version
    // during the OCR pipeline). Uniqueness is now scoped to the pair.
    //
    // Note: PostgreSQL treats NULLs as distinct in unique indexes by
    // default, so during the Phase 1 transition — when some rows may
    // still have version_id = NULL from unbackfilled data — multiple
    // NULL-versioned rows could technically coexist. After backfill runs
    // everywhere this degenerates to strict (document_id, version_id)
    // uniqueness.
    documentVersionUnique: uniqueIndex("doc_metadata_document_version_unique").on(
      table.documentId,
      table.versionId
    ),
    complexityIdx: index("doc_metadata_complexity_idx").on(table.complexityScore),
    documentClassIdx: index("doc_metadata_class_idx").on(table.documentClass),
    totalTokensIdx: index("doc_metadata_total_tokens_idx").on(table.totalTokens),
    versionIdIdx: index("doc_metadata_version_id_idx").on(table.versionId)
  })
);
var documentPreviews = pgTable(
  "document_previews",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    documentId: bigint("document_id", { mode: "bigint" }).notNull().references(() => document.id, { onDelete: "cascade" }),
    // Versioning: which version of the document this preview belongs to.
    // Nullable during Phase 1 rollout; backfilled to the v1 row for existing documents.
    versionId: bigint("version_id", { mode: "bigint" }).references(
      () => documentVersions.id,
      { onDelete: "cascade" }
    ),
    sectionId: bigint("section_id", { mode: "bigint" }).references(
      () => documentContextChunks.id,
      { onDelete: "cascade" }
    ),
    structureId: bigint("structure_id", { mode: "bigint" }).references(
      () => documentStructure.id,
      { onDelete: "cascade" }
    ),
    previewType: varchar("preview_type", {
      length: 50,
      enum: previewTypeEnum
    }).notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    documentIdIdx: index("doc_previews_document_id_idx").on(table.documentId),
    sectionIdIdx: index("doc_previews_section_id_idx").on(table.sectionId),
    documentTypeIdx: index("doc_previews_document_type_idx").on(
      table.documentId,
      table.previewType
    ),
    versionIdIdx: index("doc_previews_version_id_idx").on(table.versionId)
  })
);
var workspaceResults = pgTable(
  "workspace_results",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: varchar("session_id", { length: 256 }).notNull(),
    // Groups related work
    userId: varchar("user_id", { length: 256 }).notNull(),
    companyId: bigint("company_id", { mode: "bigint" }).notNull().references(() => company.id, { onDelete: "cascade" }),
    documentId: bigint("document_id", { mode: "bigint" }).references(
      () => document.id,
      { onDelete: "cascade" }
    ),
    sectionId: bigint("section_id", { mode: "bigint" }).references(
      () => documentContextChunks.id,
      { onDelete: "cascade" }
    ),
    structureId: bigint("structure_id", { mode: "bigint" }).references(
      () => documentStructure.id,
      { onDelete: "cascade" }
    ),
    // Result classification
    resultType: varchar("result_type", {
      length: 50,
      enum: resultTypeEnum
    }).notNull(),
    // The actual intermediate result
    content: text("content").notNull(),
    // Rich metadata for tracking execution context
    metadata: jsonb("metadata").$type(),
    // Status tracking
    status: varchar("status", {
      length: 20,
      enum: workspaceStatusEnum
    }).notNull().default("pending"),
    // For chaining/dependencies
    parentResultId: bigint("parent_result_id", { mode: "bigint" }),
    // TTL for cleanup
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => /* @__PURE__ */ new Date()
    )
  },
  (table) => ({
    sessionIdIdx: index("workspace_session_id_idx").on(table.sessionId),
    userIdIdx: index("workspace_user_id_idx").on(table.userId),
    companyIdIdx: index("workspace_company_id_idx").on(table.companyId),
    documentIdIdx: index("workspace_document_id_idx").on(table.documentId),
    sessionTypeIdx: index("workspace_session_type_idx").on(
      table.sessionId,
      table.resultType
    ),
    statusIdx: index("workspace_status_idx").on(table.status),
    expiresAtIdx: index("workspace_expires_at_idx").on(table.expiresAt),
    parentResultIdx: index("workspace_parent_result_idx").on(table.parentResultId)
  })
);
var documentStructureRelations = relations(
  documentStructure,
  ({ one, many }) => ({
    document: one(document, {
      fields: [documentStructure.documentId],
      references: [document.id]
    }),
    parent: one(documentStructure, {
      fields: [documentStructure.parentId],
      references: [documentStructure.id],
      relationName: "structure_parent_child"
    }),
    children: many(documentStructure, {
      relationName: "structure_parent_child"
    }),
    sections: many(documentContextChunks),
    previews: many(documentPreviews)
  })
);
var documentContextChunksRelations = relations(
  documentContextChunks,
  ({ one, many }) => ({
    document: one(document, {
      fields: [documentContextChunks.documentId],
      references: [document.id]
    }),
    structure: one(documentStructure, {
      fields: [documentContextChunks.structureId],
      references: [documentStructure.id]
    }),
    retrievalChunks: many(documentRetrievalChunks),
    previews: many(documentPreviews),
    workspaceResults: many(workspaceResults)
  })
);
var documentRetrievalChunksRelations = relations(
  documentRetrievalChunks,
  ({ one }) => ({
    contextChunk: one(documentContextChunks, {
      fields: [documentRetrievalChunks.contextChunkId],
      references: [documentContextChunks.id]
    }),
    document: one(document, {
      fields: [documentRetrievalChunks.documentId],
      references: [document.id]
    })
  })
);
var documentMetadataRelations = relations(documentMetadata, ({ one }) => ({
  document: one(document, {
    fields: [documentMetadata.documentId],
    references: [document.id]
  })
}));
var documentPreviewsRelations = relations(documentPreviews, ({ one }) => ({
  document: one(document, {
    fields: [documentPreviews.documentId],
    references: [document.id]
  }),
  section: one(documentContextChunks, {
    fields: [documentPreviews.sectionId],
    references: [documentContextChunks.id]
  }),
  structure: one(documentStructure, {
    fields: [documentPreviews.structureId],
    references: [documentStructure.id]
  })
}));
var workspaceResultsRelations = relations(workspaceResults, ({ one }) => ({
  company: one(company, {
    fields: [workspaceResults.companyId],
    references: [company.id]
  }),
  document: one(document, {
    fields: [workspaceResults.documentId],
    references: [document.id]
  }),
  section: one(documentContextChunks, {
    fields: [workspaceResults.sectionId],
    references: [documentContextChunks.id]
  }),
  structure: one(documentStructure, {
    fields: [workspaceResults.structureId],
    references: [documentStructure.id]
  }),
  parentResult: one(workspaceResults, {
    fields: [workspaceResults.parentResultId],
    references: [workspaceResults.id],
    relationName: "workspace_parent_child"
  })
}));
var documentSections = documentContextChunks;
var documentSectionsRelations = documentContextChunksRelations;

// ../../packages/core/src/db/schema/knowledge-graph.ts
var entityLabelEnum = [
  "PER",
  // Person
  "ORG",
  // Organization
  "LOC",
  // Location
  "DATE",
  // Date / Time
  "MONEY",
  // Monetary value
  "EVENT",
  // Event
  "PRODUCT",
  // Product
  "LAW",
  // Legal reference
  "MISC"
  // Miscellaneous
];
var relationshipTypeEnum = [
  "WORKS_FOR",
  "LOCATED_IN",
  "RELATED_TO",
  "PART_OF",
  "CREATED_BY",
  "MENTIONS",
  "REFERENCES",
  "CO_OCCURS"
  // Two entities appear in the same chunk
];
var kgEntities = pgTable(
  "kg_entities",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    /** Normalized lowercase name (for dedup) */
    name: varchar("name", { length: 512 }).notNull(),
    /** Original casing as extracted */
    displayName: varchar("display_name", { length: 512 }).notNull(),
    label: varchar("label", { length: 20, enum: entityLabelEnum }).notNull(),
    /** Average extraction confidence across all mentions */
    confidence: real("confidence").notNull().default(0),
    /** Number of times this entity was mentioned across all chunks */
    mentionCount: integer("mention_count").notNull().default(1),
    /** Company scope — entities are company-specific */
    companyId: bigint("company_id", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => /* @__PURE__ */ new Date()
    )
  },
  (table) => ({
    nameCompanyIdx: uniqueIndex("kg_entities_name_company_idx").on(
      table.name,
      table.label,
      table.companyId
    ),
    labelIdx: index("kg_entities_label_idx").on(table.label),
    companyIdx: index("kg_entities_company_idx").on(table.companyId),
    nameIdx: index("kg_entities_name_idx").on(table.name)
  })
);
var kgEntityMentions = pgTable(
  "kg_entity_mentions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entityId: bigint("entity_id", { mode: "number" }).notNull().references(() => kgEntities.id, { onDelete: "cascade" }),
    sectionId: bigint("section_id", { mode: "number" }).notNull().references(() => documentSections.id, { onDelete: "cascade" }),
    documentId: bigint("document_id", { mode: "bigint" }).notNull().references(() => document.id, { onDelete: "cascade" }),
    /** Confidence score for this specific mention */
    confidence: real("confidence").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    entityIdx: index("kg_mentions_entity_idx").on(table.entityId),
    sectionIdx: index("kg_mentions_section_idx").on(table.sectionId),
    documentIdx: index("kg_mentions_document_idx").on(table.documentId),
    entitySectionUnique: uniqueIndex("kg_mentions_entity_section_unique").on(
      table.entityId,
      table.sectionId
    )
  })
);
var kgRelationships = pgTable(
  "kg_relationships",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sourceEntityId: bigint("source_entity_id", { mode: "number" }).notNull().references(() => kgEntities.id, { onDelete: "cascade" }),
    targetEntityId: bigint("target_entity_id", { mode: "number" }).notNull().references(() => kgEntities.id, { onDelete: "cascade" }),
    relationshipType: varchar("relationship_type", {
      length: 30,
      enum: relationshipTypeEnum
    }).notNull(),
    /** Strength/weight of the relationship (0-1) */
    weight: real("weight").notNull().default(0.5),
    /** Number of co-occurrences supporting this relationship */
    evidenceCount: integer("evidence_count").notNull().default(1),
    /** Source document where relationship was first observed */
    documentId: bigint("document_id", { mode: "bigint" }).references(
      () => document.id,
      { onDelete: "set null" }
    ),
    companyId: bigint("company_id", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(
      () => /* @__PURE__ */ new Date()
    )
  },
  (table) => ({
    sourceIdx: index("kg_rel_source_idx").on(table.sourceEntityId),
    targetIdx: index("kg_rel_target_idx").on(table.targetEntityId),
    typeIdx: index("kg_rel_type_idx").on(table.relationshipType),
    companyIdx: index("kg_rel_company_idx").on(table.companyId),
    sourceTargetUnique: uniqueIndex("kg_rel_source_target_type_unique").on(
      table.sourceEntityId,
      table.targetEntityId,
      table.relationshipType
    )
  })
);
var kgEntitiesRelations = relations(kgEntities, ({ many }) => ({
  mentions: many(kgEntityMentions),
  outgoingRelationships: many(kgRelationships, {
    relationName: "source_relationships"
  }),
  incomingRelationships: many(kgRelationships, {
    relationName: "target_relationships"
  })
}));
var kgEntityMentionsRelations = relations(
  kgEntityMentions,
  ({ one }) => ({
    entity: one(kgEntities, {
      fields: [kgEntityMentions.entityId],
      references: [kgEntities.id]
    }),
    section: one(documentSections, {
      fields: [kgEntityMentions.sectionId],
      references: [documentSections.id]
    }),
    document: one(document, {
      fields: [kgEntityMentions.documentId],
      references: [document.id]
    })
  })
);
var kgRelationshipsRelations = relations(
  kgRelationships,
  ({ one }) => ({
    source: one(kgEntities, {
      fields: [kgRelationships.sourceEntityId],
      references: [kgEntities.id],
      relationName: "source_relationships"
    }),
    target: one(kgEntities, {
      fields: [kgRelationships.targetEntityId],
      references: [kgEntities.id],
      relationName: "target_relationships"
    }),
    document: one(document, {
      fields: [kgRelationships.documentId],
      references: [document.id]
    })
  })
);

// ../../packages/core/src/db/schema/ops.ts
var dataBackfills = pgTable("data_backfills", {
  /** Stable identifier, e.g. "2026-08-note-embeddings". Never reused. */
  id: varchar("id", { length: 128 }).primaryKey(),
  /** pending | running | done | failed */
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  /** Opaque keyset resume point, written after each batch. */
  cursor: jsonb("cursor").$type(),
  processed: bigint("processed", { mode: "number" }).notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull()
});

// ../../packages/core/src/internal/slot.ts
var STORE = globalThis;
function createSlot(name) {
  const key = Symbol.for(`@launchstack/core:${name}`);
  return {
    get: () => STORE[key],
    set: (value) => {
      STORE[key] = value;
    },
    clear: () => {
      delete STORE[key];
    }
  };
}

// ../../packages/core/src/db/index.ts
function createDb(config) {
  const client = src_default(config.url, { max: config.maxConnections ?? 10 });
  const db = drizzle(client, { schema: schema_exports });
  return {
    db,
    client,
    close: () => client.end({ timeout: 5 })
  };
}
var dbSlot = createSlot("db/client");

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json2 = JSON.stringify(obj, null, 2);
  return json2.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage2 = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage2 = map(fullIssue, { data, defaultError: errorMessage2 }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage2
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version2) {
  if ((version2 === "v4" || !version2) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version2 === "v6" || !version2) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version2) {
  if ((version2 === "v4" || !version2) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version2 === "v6" || !version2) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index2) {
    return new _ZodObject({
      ...this._def,
      catchall: index2
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types2, params) => {
  return new ZodUnion({
    options: types2,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b2) {
  const aType = getParsedType(a);
  const bType = getParsedType(b2);
  if (a === b2) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b2);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b2 };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b2[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b2.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index2 = 0; index2 < a.length; index2++) {
      const itemA = a[index2];
      const itemB = b2[index2];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b2) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index2) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index2, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index2, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size2, message) {
    return this.min(size2, message).max(size2, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values2, params) {
  return new ZodEnum({
    values: values2,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values2, newDef = this._def) {
    return _ZodEnum.create(values2, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values2, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values2.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values2, params) => {
  return new ZodNativeEnum({
    values: values2,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b2) {
    return new _ZodPipeline({
      in: a,
      out: b2,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// ../../packages/features/src/call-notes/contracts.ts
var CALL_NOTES_SCHEMA_VERSION = "call-notes/v1";
var CALL_NOTES_ENRICHMENT_SCHEMA_VERSION = "call-notes-enrichment/v1";
var IdSchema = external_exports.string().min(1).max(64);
var ProviderKeySchema = external_exports.string().min(1).max(256);
var TimestampSchema = external_exports.string().datetime({ offset: true });
var CompanyIdSchema = external_exports.string().regex(/^\d+$/);
var MarkdownSchema = external_exports.string().max(12e4);
var RichTextSchema = external_exports.record(external_exports.unknown());
var CallNotesProviderSchema = external_exports.literal("zoom");
var CallStatusSchema = external_exports.enum(["active", "finalizing", "completed", "failed"]);
var CaptureDesiredModeSchema = external_exports.enum(["running", "paused"]);
var CaptureLifecycleSchema = external_exports.enum([
  "connecting",
  "live",
  "interrupted",
  "finalizing",
  "completed",
  "failed"
]);
var CaptureOutcomeSchema = external_exports.enum(["complete", "partial", "failed"]);
var CaptureAttemptLifecycleSchema = external_exports.enum([
  "connecting",
  "live",
  "reconnecting",
  "ended",
  "failed"
]);
var GapKindSchema = external_exports.enum([
  "user_paused",
  "capture_user_absent",
  "transport_interruption",
  "worker_unavailable",
  "provider_unknown"
]);
var NoteVisibilitySchema = external_exports.enum(["company", "private"]);
var EnrichmentStatusSchema = external_exports.enum([
  "queued",
  "generating",
  "ready",
  "rejected",
  "accepted",
  "failed"
]);
var ParticipantIdentitySchema = external_exports.object({
  providerParticipantKey: ProviderKeySchema,
  providerSessionKey: ProviderKeySchema.optional(),
  displayName: external_exports.string().min(1).max(512)
});
var CaptureSourceCapabilitiesSchema = external_exports.object({
  attributedTranscript: external_exports.boolean(),
  nativePauseResume: external_exports.boolean(),
  transportReconnect: external_exports.boolean(),
  observesCaptureUserReturn: external_exports.boolean()
});
var CaptureEventBaseSchema = external_exports.object({
  schemaVersion: external_exports.literal(CALL_NOTES_SCHEMA_VERSION),
  eventId: IdSchema,
  provider: CallNotesProviderSchema,
  occurrenceKey: ProviderKeySchema,
  attemptKey: ProviderKeySchema.optional(),
  occurredAt: TimestampSchema
});
var CaptureEventSchema = external_exports.discriminatedUnion("kind", [
  CaptureEventBaseSchema.extend({
    kind: external_exports.literal("attempt_connected"),
    attemptKey: ProviderKeySchema,
    streamKey: ProviderKeySchema
  }),
  CaptureEventBaseSchema.extend({
    kind: external_exports.literal("attempt_paused"),
    attemptKey: ProviderKeySchema
  }),
  CaptureEventBaseSchema.extend({
    kind: external_exports.literal("attempt_resumed"),
    attemptKey: ProviderKeySchema
  }),
  CaptureEventBaseSchema.extend({
    kind: external_exports.literal("transport_interrupted"),
    attemptKey: ProviderKeySchema,
    reason: external_exports.string().max(512).optional()
  }),
  CaptureEventBaseSchema.extend({
    kind: external_exports.literal("transport_reconnected"),
    attemptKey: ProviderKeySchema
  }),
  CaptureEventBaseSchema.extend({
    kind: external_exports.literal("attempt_ended"),
    attemptKey: ProviderKeySchema,
    reason: external_exports.enum(["capture_user_left", "meeting_ended", "provider_stopped"])
  }),
  CaptureEventBaseSchema.extend({
    kind: external_exports.literal("attempt_failed"),
    attemptKey: ProviderKeySchema,
    code: external_exports.string().min(1).max(128),
    message: external_exports.string().max(1024).optional()
  }),
  CaptureEventBaseSchema.extend({
    kind: external_exports.enum(["participant_joined", "participant_left", "participant_returned"]),
    attemptKey: ProviderKeySchema,
    participant: ParticipantIdentitySchema
  }),
  CaptureEventBaseSchema.extend({
    kind: external_exports.literal("transcript_segment"),
    attemptKey: ProviderKeySchema,
    providerEventKey: ProviderKeySchema.optional(),
    sourcePacketHash: external_exports.string().regex(/^[a-f0-9]{64}$/),
    sourceKind: external_exports.enum(["provider_transcript", "derived_asr"]),
    participant: ParticipantIdentitySchema.nullable(),
    providerStartMs: external_exports.number().int().nonnegative().optional(),
    providerEndMs: external_exports.number().int().nonnegative().optional(),
    receivedAt: TimestampSchema,
    receiveOrder: external_exports.number().int().nonnegative(),
    text: external_exports.string().min(1).max(2e4),
    language: external_exports.string().min(1).max(32).optional()
  }),
  CaptureEventBaseSchema.extend({
    kind: external_exports.literal("occurrence_ended"),
    reason: external_exports.string().max(512).optional()
  })
]);
var StartCaptureInputSchema = external_exports.object({
  schemaVersion: external_exports.literal(CALL_NOTES_SCHEMA_VERSION),
  provider: CallNotesProviderSchema,
  occurrenceKey: ProviderKeySchema,
  attemptKey: ProviderKeySchema,
  authorizationRef: IdSchema,
  captureUser: ParticipantIdentitySchema
});
var CaptureControlInputSchema = external_exports.object({
  schemaVersion: external_exports.literal(CALL_NOTES_SCHEMA_VERSION),
  provider: CallNotesProviderSchema,
  occurrenceKey: ProviderKeySchema,
  attemptKey: ProviderKeySchema
});
var TranscriptSegmentSchema = external_exports.object({
  id: IdSchema,
  attemptId: IdSchema,
  participantId: IdSchema.nullable(),
  speakerName: external_exports.string().min(1).max(512).nullable(),
  providerStartMs: external_exports.number().int().nonnegative().nullable(),
  providerEndMs: external_exports.number().int().nonnegative().nullable(),
  receivedAt: TimestampSchema,
  receiveOrder: external_exports.number().int().nonnegative(),
  text: external_exports.string().min(1).max(2e4),
  language: external_exports.string().min(1).max(32).nullable()
});
var GapSchema = external_exports.object({
  id: IdSchema,
  attemptId: IdSchema.nullable(),
  kind: GapKindSchema,
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.nullable()
});
var BookmarkSchema = external_exports.object({
  id: IdSchema,
  segmentId: IdSchema,
  comment: external_exports.string().max(2e3).nullable(),
  createdAt: TimestampSchema
});
var CallNoteSchema = external_exports.object({
  documentNoteId: external_exports.number().int().positive().nullable(),
  ownerUserId: external_exports.string().min(1).max(256).nullable(),
  visibility: NoteVisibilitySchema,
  knowledgeIncluded: external_exports.boolean(),
  revision: external_exports.number().int().nonnegative(),
  title: external_exports.string().max(512),
  contentMarkdown: MarkdownSchema,
  contentRich: RichTextSchema,
  saveState: external_exports.enum(["saved", "saving", "failed"])
});
var BookmarkCitationSchema = external_exports.object({
  bookmarkId: IdSchema,
  segmentId: IdSchema,
  speakerName: external_exports.string().min(1).max(512).nullable(),
  providerStartMs: external_exports.number().int().nonnegative().nullable()
});
var EnrichedNoteProposalSchema = external_exports.object({
  schemaVersion: external_exports.literal(CALL_NOTES_ENRICHMENT_SCHEMA_VERSION),
  chronologicalSections: external_exports.array(
    external_exports.object({
      heading: external_exports.string().min(1).max(256),
      markdown: external_exports.string().min(1).max(2e4),
      ownerContextLabels: external_exports.array(external_exports.string().min(1).max(512)).max(20).default([])
    })
  ).min(1).max(100),
  summary: external_exports.string().min(1).max(2e4),
  decisions: external_exports.array(
    external_exports.object({
      text: external_exports.string().min(1).max(2e3)
    })
  ).max(100),
  actionItems: external_exports.array(
    external_exports.object({
      text: external_exports.string().min(1).max(2e3),
      ownerName: external_exports.string().min(1).max(512).nullable(),
      dueDate: external_exports.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
    })
  ).max(100),
  bookmarkPassages: external_exports.array(
    external_exports.object({
      markdown: external_exports.string().min(1).max(1e4),
      citations: external_exports.array(BookmarkCitationSchema).min(1).max(20)
    })
  ).max(100),
  conflicts: external_exports.array(
    external_exports.object({
      ownerText: external_exports.string().min(1).max(4e3),
      explanation: external_exports.string().min(1).max(4e3)
    })
  ).max(100)
});
var ModelMetadataSchema = external_exports.object({
  provider: external_exports.string().min(1).max(128),
  model: external_exports.string().min(1).max(256),
  promptVersion: external_exports.string().min(1).max(128),
  completionId: external_exports.string().min(1).max(256).optional()
});
var EnrichmentRunSchema = external_exports.object({
  id: IdSchema,
  status: EnrichmentStatusSchema,
  baseNoteRevision: external_exports.number().int().nonnegative(),
  transcriptFingerprint: external_exports.string().regex(/^[a-f0-9]{64}$/),
  proposal: EnrichedNoteProposalSchema.nullable(),
  modelMetadata: ModelMetadataSchema.nullable(),
  createdAt: TimestampSchema,
  resolvedAt: TimestampSchema.nullable()
}).superRefine((run, context) => {
  const requiresArtifacts = run.status === "ready" || run.status === "accepted" || run.status === "rejected";
  if (requiresArtifacts && run.proposal === null) {
    context.addIssue({
      code: "custom",
      path: ["proposal"],
      message: `${run.status} enrichment requires a proposal`
    });
  }
  if (requiresArtifacts && run.modelMetadata === null) {
    context.addIssue({
      code: "custom",
      path: ["modelMetadata"],
      message: `${run.status} enrichment requires model metadata`
    });
  }
  if ((run.status === "accepted" || run.status === "rejected") && run.resolvedAt === null) {
    context.addIssue({
      code: "custom",
      path: ["resolvedAt"],
      message: `${run.status} enrichment requires a resolution timestamp`
    });
  }
});
var ViewerCapabilitiesSchema = external_exports.object({
  canEditNote: external_exports.boolean(),
  canControlCapture: external_exports.boolean(),
  canBookmark: external_exports.boolean(),
  canRequestEnrichment: external_exports.boolean(),
  canResolveEnrichment: external_exports.boolean(),
  canChangeVisibility: external_exports.boolean(),
  canChangeKnowledgeInclusion: external_exports.boolean(),
  canDelete: external_exports.boolean()
});
var CaptureSnapshotSchema = external_exports.object({
  id: IdSchema,
  desiredMode: CaptureDesiredModeSchema,
  lifecycle: CaptureLifecycleSchema,
  outcome: CaptureOutcomeSchema.nullable(),
  activeAttemptId: IdSchema.nullable(),
  attemptCount: external_exports.number().int().nonnegative()
});
var CallSnapshotSchema = external_exports.object({
  schemaVersion: external_exports.literal(CALL_NOTES_SCHEMA_VERSION),
  id: IdSchema,
  companyId: CompanyIdSchema,
  provider: CallNotesProviderSchema,
  occurrenceKey: ProviderKeySchema,
  title: external_exports.string().min(1).max(512),
  status: CallStatusSchema,
  capture: CaptureSnapshotSchema,
  viewerCapabilities: ViewerCapabilitiesSchema,
  transcript: external_exports.array(TranscriptSegmentSchema),
  gaps: external_exports.array(GapSchema),
  bookmarks: external_exports.array(BookmarkSchema),
  note: CallNoteSchema.nullable(),
  enrichment: EnrichmentRunSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema
}).superRefine((snapshot, context) => {
  if (snapshot.note === null && snapshot.enrichment !== null) {
    context.addIssue({
      code: "custom",
      path: ["enrichment"],
      message: "Private-note projections must redact enrichment"
    });
  }
});
var DetectedCallCandidateSchema = external_exports.object({
  schemaVersion: external_exports.literal(CALL_NOTES_SCHEMA_VERSION),
  provider: CallNotesProviderSchema,
  occurrenceKey: ProviderKeySchema,
  title: external_exports.string().min(1).max(512),
  detectedAt: TimestampSchema,
  endsAt: TimestampSchema.nullable()
});
var UserCommandBaseSchema = external_exports.object({
  schemaVersion: external_exports.literal(CALL_NOTES_SCHEMA_VERSION),
  requestId: IdSchema,
  companyId: CompanyIdSchema,
  actorUserId: external_exports.string().min(1).max(256)
});
var CallNotesCommandSchema = external_exports.discriminatedUnion("kind", [
  UserCommandBaseSchema.extend({
    kind: external_exports.literal("start_capture"),
    provider: CallNotesProviderSchema,
    occurrenceKey: ProviderKeySchema,
    authorizationRef: IdSchema,
    title: external_exports.string().min(1).max(512).optional()
  }),
  UserCommandBaseSchema.extend({
    kind: external_exports.literal("dismiss_detected_occurrence"),
    provider: CallNotesProviderSchema,
    occurrenceKey: ProviderKeySchema
  }),
  UserCommandBaseSchema.extend({ kind: external_exports.literal("pause_capture"), callId: IdSchema }),
  UserCommandBaseSchema.extend({ kind: external_exports.literal("resume_capture"), callId: IdSchema }),
  UserCommandBaseSchema.extend({
    kind: external_exports.literal("update_note"),
    callId: IdSchema,
    baseRevision: external_exports.number().int().nonnegative(),
    title: external_exports.string().max(512),
    contentMarkdown: MarkdownSchema,
    contentRich: RichTextSchema
  }),
  UserCommandBaseSchema.extend({
    kind: external_exports.literal("add_bookmark"),
    callId: IdSchema,
    segmentId: IdSchema,
    comment: external_exports.string().max(2e3).nullable()
  }),
  UserCommandBaseSchema.extend({
    kind: external_exports.literal("set_note_visibility"),
    callId: IdSchema,
    visibility: NoteVisibilitySchema
  }),
  UserCommandBaseSchema.extend({ kind: external_exports.literal("request_enrichment"), callId: IdSchema }),
  UserCommandBaseSchema.extend({
    kind: external_exports.literal("reject_enrichment"),
    callId: IdSchema,
    enrichmentRunId: IdSchema
  }),
  UserCommandBaseSchema.extend({
    kind: external_exports.literal("accept_enrichment"),
    callId: IdSchema,
    enrichmentRunId: IdSchema,
    contentMarkdown: MarkdownSchema,
    contentRich: RichTextSchema
  }),
  UserCommandBaseSchema.extend({
    kind: external_exports.literal("set_knowledge_inclusion"),
    callId: IdSchema,
    included: external_exports.boolean()
  }),
  UserCommandBaseSchema.extend({ kind: external_exports.literal("delete_call"), callId: IdSchema })
]);
var CallQuerySchema = external_exports.object({
  companyId: CompanyIdSchema,
  actorUserId: external_exports.string().min(1).max(256),
  callId: IdSchema
});
var CallListQuerySchema = external_exports.object({
  companyId: CompanyIdSchema,
  actorUserId: external_exports.string().min(1).max(256),
  limit: external_exports.number().int().min(1).max(100).default(50)
});
var TranscriptSearchQuerySchema = CallQuerySchema.extend({
  query: external_exports.string().min(1).max(512)
});
var EnrichmentInputSchema = external_exports.object({
  schemaVersion: external_exports.literal(CALL_NOTES_ENRICHMENT_SCHEMA_VERSION),
  callId: IdSchema,
  transcriptFingerprint: external_exports.string().regex(/^[a-f0-9]{64}$/),
  transcript: external_exports.array(TranscriptSegmentSchema).min(1),
  gaps: external_exports.array(GapSchema),
  bookmarks: external_exports.array(BookmarkSchema),
  note: CallNoteSchema
});
var EnrichmentResultSchema = external_exports.object({
  proposal: EnrichedNoteProposalSchema,
  modelMetadata: ModelMetadataSchema
});
var KnowledgeNoteSchema = external_exports.object({
  companyId: CompanyIdSchema,
  callId: IdSchema,
  documentNoteId: external_exports.number().int().positive(),
  ownerUserId: external_exports.string().min(1).max(256),
  revision: external_exports.number().int().positive(),
  title: external_exports.string().max(512),
  contentMarkdown: MarkdownSchema,
  deepLink: external_exports.string().min(1).max(2048)
});
var CompleteEnrichmentInputSchema = external_exports.object({
  companyId: CompanyIdSchema,
  callId: IdSchema,
  enrichmentRunId: IdSchema,
  result: EnrichmentResultSchema
});

// ../../packages/features/src/call-notes/application.ts
import { createHash, randomUUID as randomUUID2 } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

// ../../packages/features/src/call-notes/schema.ts
var callNotesCallStatusEnum = ["active", "finalizing", "completed", "failed"];
var callNotesCaptureDesiredModeEnum = ["running", "paused"];
var callNotesCaptureLifecycleEnum = [
  "connecting",
  "live",
  "interrupted",
  "finalizing",
  "completed",
  "failed"
];
var callNotesCaptureOutcomeEnum = ["complete", "partial", "failed"];
var callNotesAttemptLifecycleEnum = [
  "connecting",
  "live",
  "reconnecting",
  "ended",
  "failed"
];
var callNotesGapKindEnum = [
  "user_paused",
  "capture_user_absent",
  "transport_interruption",
  "worker_unavailable",
  "provider_unknown"
];
var callNotesNoteVisibilityEnum = ["company", "private"];
var callNotesEnrichmentStatusEnum = [
  "queued",
  "generating",
  "ready",
  "rejected",
  "accepted",
  "failed"
];
var callNotesWorkItemKindEnum = [
  "start",
  "pause",
  "resume",
  "provider_event",
  "finalize",
  "enrich",
  "reindex"
];
var callNotesWorkItemStatusEnum = ["pending", "claimed", "completed", "failed"];
var callNotesZoomConnections = pgTable(
  "call_notes_zoom_connections",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    companyId: bigint("company_id", { mode: "bigint" }).notNull().references(() => company.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 256 }).notNull(),
    zoomAccountId: varchar("zoom_account_id", { length: 256 }).notNull(),
    zoomUserId: varchar("zoom_user_id", { length: 256 }).notNull(),
    encryptedAccessToken: text("encrypted_access_token"),
    encryptedRefreshToken: text("encrypted_refresh_token"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: text("scopes").array().notNull().default([]),
    status: varchar("status", {
      length: 24,
      enum: ["active", "revoked", "disconnected"]
    }).notNull().default("active"),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => /* @__PURE__ */ new Date())
  },
  (table) => ({
    companyUserUnique: uniqueIndex("call_notes_zoom_connections_company_user_unique").on(
      table.companyId,
      table.userId
    ),
    companyZoomUserUnique: uniqueIndex(
      "call_notes_zoom_connections_company_zoom_user_unique"
    ).on(table.companyId, table.zoomUserId)
  })
);
var callNotesCalls = pgTable(
  "call_notes_calls",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    companyId: bigint("company_id", { mode: "bigint" }).notNull().references(() => company.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32, enum: ["zoom"] }).notNull(),
    providerOccurrenceKey: varchar("provider_occurrence_key", { length: 256 }).notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    status: varchar("status", { length: 32, enum: callNotesCallStatusEnum }).notNull().default("active"),
    documentNoteId: bigint("document_note_id", { mode: "number" }),
    noteOwnerUserId: varchar("note_owner_user_id", { length: 256 }),
    noteVisibility: varchar("note_visibility", {
      length: 16,
      enum: callNotesNoteVisibilityEnum
    }).notNull().default("company"),
    knowledgeIncluded: boolean("knowledge_included").notNull().default(false),
    currentNoteRevision: integer("current_note_revision").notNull().default(0),
    failureCode: varchar("failure_code", { length: 128 }),
    failureMessage: varchar("failure_message", { length: 1024 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => /* @__PURE__ */ new Date())
  },
  (table) => ({
    occurrenceUnique: uniqueIndex("call_notes_calls_company_occurrence_unique").on(
      table.companyId,
      table.provider,
      table.providerOccurrenceKey
    ),
    companyCreatedIdx: index("call_notes_calls_company_created_at_idx").on(
      table.companyId,
      table.createdAt
    ),
    companyStatusIdx: index("call_notes_calls_company_status_idx").on(
      table.companyId,
      table.status
    ),
    documentNoteUnique: uniqueIndex("call_notes_calls_document_note_unique").on(
      table.documentNoteId
    )
  })
);
var callNotesCaptures = pgTable(
  "call_notes_captures",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    callId: varchar("call_id", { length: 64 }).notNull().references(() => callNotesCalls.id, { onDelete: "cascade" }),
    companyId: bigint("company_id", { mode: "bigint" }).notNull().references(() => company.id, { onDelete: "cascade" }),
    captureUserConnectionId: varchar("capture_user_connection_id", { length: 64 }).notNull().references(() => callNotesZoomConnections.id, { onDelete: "restrict" }),
    captureUserProviderKey: varchar("capture_user_provider_key", { length: 256 }).notNull(),
    desiredMode: varchar("desired_mode", {
      length: 16,
      enum: callNotesCaptureDesiredModeEnum
    }).notNull().default("running"),
    lifecycle: varchar("lifecycle", {
      length: 32,
      enum: callNotesCaptureLifecycleEnum
    }).notNull().default("connecting"),
    outcome: varchar("outcome", { length: 16, enum: callNotesCaptureOutcomeEnum }),
    activeAttemptId: varchar("active_attempt_id", { length: 64 }),
    startedAt: timestamp("started_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).$onUpdate(() => /* @__PURE__ */ new Date())
  },
  (table) => ({
    callUnique: uniqueIndex("call_notes_captures_call_unique").on(table.callId),
    companyLifecycleIdx: index("call_notes_captures_company_lifecycle_idx").on(
      table.companyId,
      table.lifecycle
    )
  })
);
var callNotesCaptureAttempts = pgTable(
  "call_notes_capture_attempts",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    captureId: varchar("capture_id", { length: 64 }).notNull().references(() => callNotesCaptures.id, { onDelete: "cascade" }),
    callId: varchar("call_id", { length: 64 }).notNull().references(() => callNotesCalls.id, { onDelete: "cascade" }),
    companyId: bigint("company_id", { mode: "bigint" }).notNull().references(() => company.id, { onDelete: "cascade" }),
    providerAttemptKey: varchar("provider_attempt_key", { length: 256 }).notNull(),
    providerStreamKey: varchar("provider_stream_key", { length: 256 }),
    lifecycle: varchar("lifecycle", {
      length: 24,
      enum: callNotesAttemptLifecycleEnum
    }).notNull().default("connecting"),
    leaseToken: varchar("lease_token", { length: 128 }),
    leaseOwner: varchar("lease_owner", { length: 256 }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    failureCode: varchar("failure_code", { length: 128 }),
    failureMessage: varchar("failure_message", { length: 1024 })
  },
  (table) => ({
    providerAttemptUnique: uniqueIndex(
      "call_notes_capture_attempts_capture_provider_key_unique"
    ).on(table.captureId, table.providerAttemptKey),
    oneActiveAttemptUnique: uniqueIndex("call_notes_capture_attempts_one_active_unique").on(table.captureId).where(sql`${table.lifecycle} in ('connecting', 'live', 'reconnecting')`),
    captureStartedIdx: index("call_notes_capture_attempts_capture_started_idx").on(
      table.captureId,
      table.startedAt
    ),
    leaseIdx: index("call_notes_capture_attempts_lease_idx").on(
      table.lifecycle,
      table.leaseExpiresAt
    )
  })
);
var callNotesParticipants = pgTable(
  "call_notes_participants",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    callId: varchar("call_id", { length: 64 }).notNull().references(() => callNotesCalls.id, { onDelete: "cascade" }),
    attemptId: varchar("attempt_id", { length: 64 }).notNull().references(() => callNotesCaptureAttempts.id, { onDelete: "cascade" }),
    companyId: bigint("company_id", { mode: "bigint" }).notNull().references(() => company.id, { onDelete: "cascade" }),
    providerParticipantKey: varchar("provider_participant_key", { length: 256 }).notNull(),
    providerSessionKey: varchar("provider_session_key", { length: 256 }),
    displayName: varchar("display_name", { length: 512 }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    leftAt: timestamp("left_at", { withTimezone: true })
  },
  (table) => ({
    attemptParticipantIdx: index("call_notes_participants_attempt_key_idx").on(
      table.attemptId,
      table.providerParticipantKey
    ),
    callObservedIdx: index("call_notes_participants_call_observed_idx").on(
      table.callId,
      table.observedAt
    )
  })
);
var callNotesTranscriptSegments = pgTable(
  "call_notes_transcript_segments",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    callId: varchar("call_id", { length: 64 }).notNull().references(() => callNotesCalls.id, { onDelete: "cascade" }),
    attemptId: varchar("attempt_id", { length: 64 }).notNull().references(() => callNotesCaptureAttempts.id, { onDelete: "cascade" }),
    participantId: varchar("participant_id", { length: 64 }).references(
      () => callNotesParticipants.id,
      { onDelete: "set null" }
    ),
    companyId: bigint("company_id", { mode: "bigint" }).notNull().references(() => company.id, { onDelete: "cascade" }),
    providerEventKey: varchar("provider_event_key", { length: 256 }),
    sourcePacketHash: varchar("source_packet_hash", { length: 64 }).notNull(),
    sourceKind: varchar("source_kind", {
      length: 32,
      enum: ["provider_transcript", "derived_asr"]
    }).notNull(),
    speakerName: varchar("speaker_name", { length: 512 }),
    providerStartMs: bigint("provider_start_ms", { mode: "number" }),
    providerEndMs: bigint("provider_end_ms", { mode: "number" }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    receiveOrder: integer("receive_order").notNull(),
    text: text("text").notNull(),
    language: varchar("language", { length: 32 }),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    packetUnique: uniqueIndex("call_notes_segments_attempt_packet_unique").on(
      table.attemptId,
      table.sourcePacketHash
    ),
    callOrderIdx: index("call_notes_segments_call_order_idx").on(
      table.callId,
      table.providerStartMs,
      table.receiveOrder
    ),
    companyReceivedIdx: index("call_notes_segments_company_received_idx").on(
      table.companyId,
      table.receivedAt
    )
  })
);
var callNotesGaps = pgTable(
  "call_notes_gaps",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    callId: varchar("call_id", { length: 64 }).notNull().references(() => callNotesCalls.id, { onDelete: "cascade" }),
    captureId: varchar("capture_id", { length: 64 }).notNull().references(() => callNotesCaptures.id, { onDelete: "cascade" }),
    attemptId: varchar("attempt_id", { length: 64 }).references(
      () => callNotesCaptureAttempts.id,
      { onDelete: "set null" }
    ),
    companyId: bigint("company_id", { mode: "bigint" }).notNull().references(() => company.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 32, enum: callNotesGapKindEnum }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    details: jsonb("details").$type()
  },
  (table) => ({
    callStartedIdx: index("call_notes_gaps_call_started_idx").on(table.callId, table.startedAt)
  })
);
var callNotesBookmarks = pgTable(
  "call_notes_bookmarks",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    callId: varchar("call_id", { length: 64 }).notNull().references(() => callNotesCalls.id, { onDelete: "cascade" }),
    segmentId: varchar("segment_id", { length: 64 }).notNull().references(() => callNotesTranscriptSegments.id, { onDelete: "cascade" }),
    companyId: bigint("company_id", { mode: "bigint" }).notNull().references(() => company.id, { onDelete: "cascade" }),
    createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    callCreatedIdx: index("call_notes_bookmarks_call_created_idx").on(
      table.callId,
      table.createdAt
    )
  })
);
var callNotesEnrichmentRuns = pgTable(
  "call_notes_enrichment_runs",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    callId: varchar("call_id", { length: 64 }).notNull().references(() => callNotesCalls.id, { onDelete: "cascade" }),
    companyId: bigint("company_id", { mode: "bigint" }).notNull().references(() => company.id, { onDelete: "cascade" }),
    requestedByUserId: varchar("requested_by_user_id", { length: 256 }).notNull(),
    baseNoteRevision: integer("base_note_revision").notNull(),
    transcriptFingerprint: varchar("transcript_fingerprint", { length: 64 }).notNull(),
    status: varchar("status", {
      length: 24,
      enum: callNotesEnrichmentStatusEnum
    }).notNull().default("queued"),
    originalOutput: jsonb("original_output").$type(),
    editableProposal: jsonb("editable_proposal").$type(),
    modelMetadata: jsonb("model_metadata").$type(),
    errorCode: varchar("error_code", { length: 128 }),
    errorMessage: varchar("error_message", { length: 1024 }),
    resolvedByUserId: varchar("resolved_by_user_id", { length: 256 }),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true })
  },
  (table) => ({
    callCreatedIdx: index("call_notes_enrichment_runs_call_created_idx").on(
      table.callId,
      table.createdAt
    ),
    companyStatusIdx: index("call_notes_enrichment_runs_company_status_idx").on(
      table.companyId,
      table.status
    ),
    oneActiveProposalUnique: uniqueIndex("call_notes_enrichment_runs_one_active_unique").on(table.callId).where(sql`${table.status} in ('queued', 'generating', 'ready')`)
  })
);
var callNotesNoteRevisions = pgTable(
  "call_notes_note_revisions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    callId: varchar("call_id", { length: 64 }).notNull().references(() => callNotesCalls.id, { onDelete: "cascade" }),
    companyId: bigint("company_id", { mode: "bigint" }).notNull().references(() => company.id, { onDelete: "cascade" }),
    documentNoteId: bigint("document_note_id", { mode: "number" }).notNull(),
    revision: integer("revision").notNull(),
    origin: varchar("origin", { length: 24, enum: ["manual", "enrichment"] }).notNull(),
    enrichmentRunId: varchar("enrichment_run_id", { length: 64 }).references(
      () => callNotesEnrichmentRuns.id,
      { onDelete: "set null" }
    ),
    title: text("title"),
    contentMarkdown: text("content_markdown").notNull(),
    contentRich: jsonb("content_rich").$type().notNull(),
    createdByUserId: varchar("created_by_user_id", { length: 256 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull()
  },
  (table) => ({
    callRevisionUnique: uniqueIndex("call_notes_note_revisions_call_revision_unique").on(
      table.callId,
      table.revision
    ),
    documentNoteIdx: index("call_notes_note_revisions_document_note_idx").on(
      table.documentNoteId
    )
  })
);
var callNotesWorkItems = pgTable(
  "call_notes_work_items",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    companyId: bigint("company_id", { mode: "bigint" }).notNull().references(() => company.id, { onDelete: "cascade" }),
    callId: varchar("call_id", { length: 64 }).references(() => callNotesCalls.id, {
      onDelete: "cascade"
    }),
    captureId: varchar("capture_id", { length: 64 }).references(() => callNotesCaptures.id, {
      onDelete: "cascade"
    }),
    kind: varchar("kind", { length: 32, enum: callNotesWorkItemKindEnum }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 256 }).notNull(),
    payload: jsonb("payload").$type().notNull(),
    status: varchar("status", {
      length: 24,
      enum: callNotesWorkItemStatusEnum
    }).notNull().default("pending"),
    leaseToken: varchar("lease_token", { length: 128 }),
    leaseOwner: varchar("lease_owner", { length: 256 }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    errorCode: varchar("error_code", { length: 128 }),
    errorMessage: varchar("error_message", { length: 1024 }),
    availableAt: timestamp("available_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (table) => ({
    idempotencyUnique: uniqueIndex("call_notes_work_items_company_kind_key_unique").on(
      table.companyId,
      table.kind,
      table.idempotencyKey
    ),
    claimIdx: index("call_notes_work_items_claim_idx").on(
      table.status,
      table.availableAt,
      table.leaseExpiresAt
    ),
    callCreatedIdx: index("call_notes_work_items_call_created_idx").on(
      table.callId,
      table.createdAt
    )
  })
);

// ../../packages/features/src/call-notes/work-items.ts
import { randomUUID } from "node:crypto";
var CallNotesWorkItemError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "CallNotesWorkItemError";
    this.code = code;
  }
};
var defaultClock = { now: () => /* @__PURE__ */ new Date() };
var defaultIds = {
  next(prefix) {
    return `${prefix}_${randomUUID().replace(/-/g, "")}`;
  }
};
function companyNumber(companyId) {
  if (!/^\d+$/.test(companyId)) {
    throw new CallNotesWorkItemError("invalid", `Invalid company id ${companyId}`);
  }
  return BigInt(companyId);
}
function token(ids) {
  return ids.next("lease");
}
var CallNotesWorkItems = class {
  constructor(db, options = {}) {
    this.db = db;
    this.clock = options.clock ?? defaultClock;
    this.ids = options.ids ?? defaultIds;
    this.defaultLeaseMs = options.leaseMs ?? options.leaseDurationMs ?? 3e4;
  }
  clock;
  ids;
  defaultLeaseMs;
  async enqueue(input, executor = this.db) {
    const now = this.clock.now();
    const values2 = {
      id: this.ids.next(`work_${input.kind}`),
      companyId: companyNumber(input.companyId),
      callId: input.callId ?? null,
      captureId: input.captureId ?? null,
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      status: "pending",
      attempts: 0,
      availableAt: input.availableAt ?? now,
      createdAt: now
    };
    const [created] = await executor.insert(callNotesWorkItems).values(values2).onConflictDoNothing({
      target: [
        callNotesWorkItems.companyId,
        callNotesWorkItems.kind,
        callNotesWorkItems.idempotencyKey
      ]
    }).returning();
    if (created) return created;
    const [existing] = await executor.select().from(callNotesWorkItems).where(
      and(
        eq(callNotesWorkItems.companyId, values2.companyId),
        eq(callNotesWorkItems.kind, values2.kind),
        eq(callNotesWorkItems.idempotencyKey, values2.idempotencyKey)
      )
    ).limit(1);
    if (!existing) {
      throw new CallNotesWorkItemError(
        "not_found",
        `Work item ${input.kind}/${input.idempotencyKey} was not created`
      );
    }
    return existing;
  }
  async get(id) {
    const [row] = await this.db.select().from(callNotesWorkItems).where(eq(callNotesWorkItems.id, id)).limit(1);
    return row ?? null;
  }
  async claim(owner, options = {}) {
    if (!owner) throw new CallNotesWorkItemError("invalid", "A lease owner is required");
    const now = options.now ?? this.clock.now();
    const leaseMs = options.leaseMs ?? options.leaseDurationMs ?? this.defaultLeaseMs;
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
      throw new CallNotesWorkItemError("invalid", "leaseMs must be positive");
    }
    const company2 = options.companyId === void 0 ? void 0 : companyNumber(options.companyId);
    return this.db.transaction(async (tx) => {
      const predicates = [
        or(
          eq(callNotesWorkItems.status, "pending"),
          and(
            eq(callNotesWorkItems.status, "claimed"),
            lte(callNotesWorkItems.leaseExpiresAt, now)
          )
        ),
        lte(callNotesWorkItems.availableAt, now),
        ...company2 === void 0 ? [] : [eq(callNotesWorkItems.companyId, company2)],
        ...options.kind === void 0 ? [] : [eq(callNotesWorkItems.kind, options.kind)]
      ];
      const [candidate] = await tx.select().from(callNotesWorkItems).where(and(...predicates)).orderBy(
        asc(callNotesWorkItems.availableAt),
        asc(callNotesWorkItems.createdAt),
        asc(callNotesWorkItems.id)
      ).for("update", { skipLocked: true }).limit(1);
      if (!candidate) return null;
      const leaseToken = token(this.ids);
      const leaseExpiresAt = new Date(now.getTime() + leaseMs);
      const [claimed] = await tx.update(callNotesWorkItems).set({
        status: "claimed",
        leaseToken,
        leaseOwner: owner,
        leaseExpiresAt,
        attempts: candidate.attempts + 1
      }).where(eq(callNotesWorkItems.id, candidate.id)).returning();
      if (!claimed?.leaseToken || !claimed.leaseOwner || !claimed.leaseExpiresAt) {
        throw new CallNotesWorkItemError(
          "invalid",
          `Unable to claim work item ${candidate.id}`
        );
      }
      return {
        ...claimed,
        leaseToken: claimed.leaseToken,
        leaseOwner: claimed.leaseOwner,
        leaseExpiresAt: claimed.leaseExpiresAt,
        fencingToken: claimed.leaseToken
      };
    });
  }
  /**
   * Claims one specific receipt with the same lease/fencing semantics as a
   * worker claim. This is used by provider event delivery, where duplicate
   * deliveries must not both apply the event.
   */
  async claimById(id, owner, options = {}) {
    if (!id || !owner) {
      throw new CallNotesWorkItemError(
        "invalid",
        "A receipt id and lease owner are required"
      );
    }
    const now = options.now ?? this.clock.now();
    const leaseMs = options.leaseMs ?? options.leaseDurationMs ?? this.defaultLeaseMs;
    if (!Number.isFinite(leaseMs) || leaseMs <= 0) {
      throw new CallNotesWorkItemError("invalid", "leaseMs must be positive");
    }
    const company2 = options.companyId === void 0 ? void 0 : companyNumber(options.companyId);
    return this.db.transaction(async (tx) => {
      const [candidate] = await tx.select().from(callNotesWorkItems).where(
        and(
          eq(callNotesWorkItems.id, id),
          or(
            eq(callNotesWorkItems.status, "pending"),
            and(
              eq(callNotesWorkItems.status, "claimed"),
              lte(callNotesWorkItems.leaseExpiresAt, now)
            )
          ),
          lte(callNotesWorkItems.availableAt, now),
          ...company2 === void 0 ? [] : [eq(callNotesWorkItems.companyId, company2)],
          ...options.kind === void 0 ? [] : [eq(callNotesWorkItems.kind, options.kind)]
        )
      ).for("update", { skipLocked: true }).limit(1);
      if (!candidate) return null;
      const leaseToken = token(this.ids);
      const leaseExpiresAt = new Date(now.getTime() + leaseMs);
      const [claimed] = await tx.update(callNotesWorkItems).set({
        status: "claimed",
        leaseToken,
        leaseOwner: owner,
        leaseExpiresAt,
        attempts: candidate.attempts + 1
      }).where(
        and(
          eq(callNotesWorkItems.id, candidate.id),
          or(
            eq(callNotesWorkItems.status, "pending"),
            and(
              eq(callNotesWorkItems.status, "claimed"),
              lte(callNotesWorkItems.leaseExpiresAt, now)
            )
          )
        )
      ).returning();
      if (!claimed?.leaseToken || !claimed.leaseOwner || !claimed.leaseExpiresAt) {
        throw new CallNotesWorkItemError(
          "invalid",
          `Unable to claim work item ${candidate.id}`
        );
      }
      return {
        ...claimed,
        leaseToken: claimed.leaseToken,
        leaseOwner: claimed.leaseOwner,
        leaseExpiresAt: claimed.leaseExpiresAt,
        fencingToken: claimed.leaseToken
      };
    });
  }
  async claimNext(owner, options = {}) {
    return this.claim(owner, options);
  }
  async complete(id, leaseToken) {
    const [updated] = await this.db.update(callNotesWorkItems).set({
      status: "completed",
      completedAt: this.clock.now(),
      leaseToken: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: null,
      errorMessage: null
    }).where(
      and(
        eq(callNotesWorkItems.id, id),
        eq(callNotesWorkItems.status, "claimed"),
        eq(callNotesWorkItems.leaseToken, leaseToken),
        gt(callNotesWorkItems.leaseExpiresAt, this.clock.now())
      )
    ).returning();
    if (updated) return updated;
    await this.assertToken(id, leaseToken);
    throw new CallNotesWorkItemError("stale_token", `Stale fencing token for ${id}`);
  }
  async fail(id, leaseToken, failure = {}) {
    const [updated] = await this.db.update(callNotesWorkItems).set({
      status: "failed",
      errorCode: failure.code ?? "work_item_failed",
      errorMessage: failure.message ?? null,
      availableAt: failure.availableAt ?? this.clock.now(),
      leaseToken: null,
      leaseOwner: null,
      leaseExpiresAt: null
    }).where(
      and(
        eq(callNotesWorkItems.id, id),
        eq(callNotesWorkItems.status, "claimed"),
        eq(callNotesWorkItems.leaseToken, leaseToken),
        gt(callNotesWorkItems.leaseExpiresAt, this.clock.now())
      )
    ).returning();
    if (updated) return updated;
    await this.assertToken(id, leaseToken);
    throw new CallNotesWorkItemError("stale_token", `Stale fencing token for ${id}`);
  }
  async release(id, leaseToken, availableAt = this.clock.now()) {
    const [updated] = await this.db.update(callNotesWorkItems).set({
      status: "pending",
      availableAt,
      leaseToken: null,
      leaseOwner: null,
      leaseExpiresAt: null
    }).where(
      and(
        eq(callNotesWorkItems.id, id),
        eq(callNotesWorkItems.status, "claimed"),
        eq(callNotesWorkItems.leaseToken, leaseToken),
        gt(callNotesWorkItems.leaseExpiresAt, this.clock.now())
      )
    ).returning();
    if (updated) return updated;
    await this.assertToken(id, leaseToken);
    throw new CallNotesWorkItemError("stale_token", `Stale fencing token for ${id}`);
  }
  /** Marks a command/event receipt complete without taking a worker lease. */
  async completeReceipt(id, payload) {
    const [updated] = await this.db.update(callNotesWorkItems).set({ status: "completed", payload, completedAt: this.clock.now() }).where(eq(callNotesWorkItems.id, id)).returning();
    if (!updated) throw new CallNotesWorkItemError("not_found", `Unknown work item ${id}`);
    return updated;
  }
  async reopenReceipt(id) {
    const [updated] = await this.db.update(callNotesWorkItems).set({ status: "pending", errorCode: null, errorMessage: null, completedAt: null }).where(eq(callNotesWorkItems.id, id)).returning();
    if (!updated) throw new CallNotesWorkItemError("not_found", `Unknown work item ${id}`);
    return updated;
  }
  async assertToken(id, leaseToken) {
    const row = await this.get(id);
    if (!row) throw new CallNotesWorkItemError("not_found", `Unknown work item ${id}`);
    if (row.leaseToken !== leaseToken || row.status !== "claimed") {
      throw new CallNotesWorkItemError("stale_token", `Stale fencing token for ${id}`);
    }
  }
};

// ../../packages/features/src/call-notes/application.ts
var CallNotesApplicationError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "CallNotesApplicationError";
    this.code = code;
  }
};
var defaultClock2 = { now: () => /* @__PURE__ */ new Date() };
var defaultIds2 = {
  next(prefix) {
    return `${prefix}_${randomUUID2().replace(/-/g, "")}`;
  }
};
var EMPTY_RICH_TEXT = { type: "doc", content: [] };
function companyNumber2(companyId) {
  if (!/^\d+$/.test(companyId)) {
    throw new CallNotesApplicationError(
      "invalid_transition",
      `Invalid company id ${companyId}`
    );
  }
  return BigInt(companyId);
}
function asDate(value) {
  return value instanceof Date ? value : new Date(value);
}
function iso(value) {
  return asDate(value).toISOString();
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function isApplicationError(error) {
  return error instanceof CallNotesApplicationError;
}
function providerTime(value) {
  return value ?? Number.POSITIVE_INFINITY;
}
function sortTranscriptRows(rows) {
  return rows.sort((left, right) => {
    const start = providerTime(left.providerStartMs) - providerTime(right.providerStartMs);
    if (start !== 0) return start;
    if (left.receiveOrder !== right.receiveOrder) return left.receiveOrder - right.receiveOrder;
    const received = asDate(left.receivedAt).getTime() - asDate(right.receivedAt).getTime();
    if (received !== 0) return received;
    return left.id.localeCompare(right.id);
  });
}
function normalizeNote(record) {
  if (!Number.isInteger(record.id) || record.id <= 0) {
    throw new CallNotesApplicationError(
      "unavailable",
      "Document note adapter returned an invalid id"
    );
  }
  return {
    id: record.id,
    title: record.title ?? "",
    contentMarkdown: record.contentMarkdown ?? "",
    contentRich: record.contentRich ?? {}
  };
}
function toTranscriptSegments(rows, participants) {
  const participantById = new Map(
    participants.map((participant) => [participant.id, participant])
  );
  return sortTranscriptRows([...rows]).map((row) => {
    const participant = row.participantId ? participantById.get(row.participantId) : void 0;
    return {
      id: row.id,
      attemptId: row.attemptId,
      participantId: row.participantId,
      speakerName: row.speakerName ?? participant?.displayName ?? null,
      providerStartMs: row.providerStartMs ?? null,
      providerEndMs: row.providerEndMs ?? null,
      receivedAt: iso(row.receivedAt),
      receiveOrder: row.receiveOrder,
      text: row.text,
      language: row.language ?? null
    };
  });
}
function toGaps(rows) {
  return rows.map((gap) => ({
    id: gap.id,
    attemptId: gap.attemptId,
    kind: gap.kind,
    startedAt: iso(gap.startedAt),
    endedAt: gap.endedAt ? iso(gap.endedAt) : null
  }));
}
function toBookmarks(rows) {
  return rows.map((bookmark) => ({
    id: bookmark.id,
    segmentId: bookmark.segmentId,
    comment: bookmark.comment,
    createdAt: iso(bookmark.createdAt)
  }));
}
function toCallNote(call, record) {
  const normalized = normalizeNote(record);
  return {
    documentNoteId: normalized.id,
    ownerUserId: call.noteOwnerUserId,
    visibility: call.noteVisibility,
    knowledgeIncluded: call.knowledgeIncluded,
    revision: call.currentNoteRevision,
    title: normalized.title,
    contentMarkdown: normalized.contentMarkdown,
    contentRich: normalized.contentRich,
    saveState: "saved"
  };
}
function enrichmentFingerprint(input) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
function commandWorkKind(command) {
  switch (command.kind) {
    case "start_capture":
    case "dismiss_detected_occurrence":
      return "start";
    case "pause_capture":
      return "pause";
    case "resume_capture":
      return "resume";
    case "request_enrichment":
    case "reject_enrichment":
    case "accept_enrichment":
      return "enrich";
    case "set_knowledge_inclusion":
      return "reindex";
    default:
      return "finalize";
  }
}
function commandCallId(command) {
  return "callId" in command ? command.callId : null;
}
function isActiveAttemptLifecycle(value) {
  return value === "connecting" || value === "live" || value === "reconnecting";
}
var PostgresCallNotesApplication = class {
  constructor(options) {
    this.options = options;
    this.clock = options.clock ?? defaultClock2;
    this.ids = options.ids ?? defaultIds2;
    this.workItems = new CallNotesWorkItems(options.db, {
      clock: this.clock,
      ids: this.ids
    });
    this.deepLink = options.callDeepLink ?? ((_companyId, callId) => `/employer/documents?feature=calls&call=${encodeURIComponent(callId)}`);
  }
  clock;
  ids;
  workItems;
  deepLink;
  async execute(command) {
    const parsed = CallNotesCommandSchema.parse(command);
    await this.requireMembership(parsed.companyId, parsed.actorUserId);
    const kind = commandWorkKind(parsed);
    const key = parsed.kind === "dismiss_detected_occurrence" ? `dismiss:${parsed.actorUserId}:${parsed.provider}:${parsed.occurrenceKey}` : parsed.requestId;
    const receipt = await this.workItems.enqueue({
      companyId: parsed.companyId,
      callId: parsed.kind === "delete_call" ? null : commandCallId(parsed),
      kind,
      idempotencyKey: key,
      payload: { command: parsed }
    });
    if (receipt.status === "completed") {
      const resultActorUserId = typeof receipt.payload.resultActorUserId === "string" ? receipt.payload.resultActorUserId : null;
      if (resultActorUserId !== parsed.actorUserId) {
        throw new CallNotesApplicationError(
          "forbidden",
          "A completed Call Notes receipt belongs to another actor"
        );
      }
      const resultCallId = receipt.payload.resultCallId;
      if (typeof resultCallId === "string") {
        await this.requireCallAccess(parsed.companyId, parsed.actorUserId, resultCallId);
      }
      return this.resultFromReceipt(receipt.payload, parsed.actorUserId);
    }
    if (commandCallId(parsed)) {
      await this.requireCallAccess(
        parsed.companyId,
        parsed.actorUserId,
        commandCallId(parsed)
      );
    }
    if (receipt.status === "failed") await this.workItems.reopenReceipt(receipt.id);
    try {
      let result;
      const retried = await this.retryCommittedReindex(parsed);
      if (retried !== void 0) {
        result = retried;
      } else {
        switch (parsed.kind) {
          case "start_capture":
            result = await this.startCapture(parsed);
            break;
          case "dismiss_detected_occurrence":
            result = null;
            break;
          case "pause_capture":
            result = await this.controlCapture(parsed, "paused");
            break;
          case "resume_capture":
            result = await this.controlCapture(parsed, "running");
            break;
          case "update_note":
            result = await this.updateNote(parsed);
            break;
          case "add_bookmark":
            result = await this.addBookmark(parsed);
            break;
          case "set_note_visibility":
            result = await this.setNoteVisibility(parsed);
            break;
          case "request_enrichment":
            result = await this.requestEnrichment(parsed);
            break;
          case "reject_enrichment":
            result = await this.rejectEnrichment(parsed);
            break;
          case "accept_enrichment":
            result = await this.acceptEnrichment(parsed);
            break;
          case "set_knowledge_inclusion":
            result = await this.setKnowledgeInclusion(parsed);
            break;
          case "delete_call":
            result = await this.deleteCall(parsed);
            break;
          default:
            throw new CallNotesApplicationError(
              "invalid_transition",
              "Unsupported Call Notes command"
            );
        }
      }
      await this.workItems.completeReceipt(receipt.id, {
        resultCallId: result?.id ?? null,
        resultActorUserId: parsed.actorUserId
      });
      return result;
    } catch (error) {
      await this.markReceiptFailed(receipt.id, error);
      throw error;
    }
  }
  async ingestCaptureEvent(companyId, event) {
    const parsed = CaptureEventSchema.parse(event);
    const company2 = companyNumber2(companyId);
    const receipt = await this.workItems.enqueue({
      companyId,
      kind: "provider_event",
      idempotencyKey: parsed.eventId,
      payload: { event: parsed }
    });
    if (receipt.status === "completed") return;
    if (receipt.status === "failed") await this.workItems.reopenReceipt(receipt.id);
    const claim = await this.workItems.claimById(
      receipt.id,
      this.ids.next(`provider_event_${parsed.eventId}`),
      {
        companyId,
        kind: "provider_event",
        leaseMs: 5 * 6e4
      }
    );
    if (!claim) return;
    try {
      const [call] = await this.options.db.select().from(callNotesCalls).where(
        and(
          eq(callNotesCalls.companyId, company2),
          eq(callNotesCalls.provider, parsed.provider),
          eq(callNotesCalls.providerOccurrenceKey, parsed.occurrenceKey)
        )
      ).limit(1);
      if (!call) {
        throw new CallNotesApplicationError("not_found", "Call occurrence not found");
      }
      await this.applyCaptureEvent(call.id, company2, parsed);
      await this.workItems.complete(claim.id, claim.leaseToken);
    } catch (error) {
      try {
        await this.workItems.fail(claim.id, claim.leaseToken, {
          code: isApplicationError(error) ? error.code : "unavailable",
          message: errorMessage(error).slice(0, 1024)
        });
      } catch {
      }
      throw error;
    }
  }
  async completeEnrichment(input) {
    const parsed = CompleteEnrichmentInputSchema.parse(input);
    const company2 = companyNumber2(parsed.companyId);
    const result = parsed.result;
    const [call] = await this.options.db.select().from(callNotesCalls).where(and(eq(callNotesCalls.id, parsed.callId), eq(callNotesCalls.companyId, company2))).limit(1);
    if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
    const [run] = await this.options.db.select().from(callNotesEnrichmentRuns).where(
      and(
        eq(callNotesEnrichmentRuns.id, parsed.enrichmentRunId),
        eq(callNotesEnrichmentRuns.callId, parsed.callId),
        eq(callNotesEnrichmentRuns.companyId, company2)
      )
    ).limit(1);
    if (!run) throw new CallNotesApplicationError("not_found", "Enrichment run not found");
    if (run.status === "accepted" || run.status === "rejected" || run.status === "ready")
      return;
    try {
      await this.options.db.update(callNotesEnrichmentRuns).set({
        status: "ready",
        originalOutput: result.proposal,
        editableProposal: result.proposal,
        modelMetadata: result.modelMetadata,
        generatedAt: this.clock.now(),
        errorCode: null,
        errorMessage: null
      }).where(eq(callNotesEnrichmentRuns.id, parsed.enrichmentRunId));
    } catch (error) {
      throw new CallNotesApplicationError(
        "unavailable",
        `Unable to complete enrichment: ${errorMessage(error)}`
      );
    }
  }
  async getCall(query) {
    const parsed = CallQuerySchema.parse(query);
    const [call] = await this.options.db.select().from(callNotesCalls).where(
      and(
        eq(callNotesCalls.id, parsed.callId),
        eq(callNotesCalls.companyId, companyNumber2(parsed.companyId))
      )
    ).limit(1);
    if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
    await this.requireMembership(parsed.companyId, parsed.actorUserId);
    return this.snapshot(call.id, parsed.actorUserId);
  }
  async listCalls(query) {
    const parsed = CallListQuerySchema.parse(query);
    await this.requireMembership(parsed.companyId, parsed.actorUserId);
    const rows = await this.options.db.select({ id: callNotesCalls.id }).from(callNotesCalls).where(eq(callNotesCalls.companyId, companyNumber2(parsed.companyId))).orderBy(desc(callNotesCalls.createdAt), desc(callNotesCalls.id)).limit(parsed.limit);
    const snapshots = [];
    for (const row of rows) snapshots.push(await this.snapshot(row.id, parsed.actorUserId));
    return snapshots;
  }
  async listDetectedCalls(query) {
    const parsed = CallListQuerySchema.parse(query);
    await this.requireMembership(parsed.companyId, parsed.actorUserId);
    let candidates;
    try {
      candidates = await this.options.detectedCalls.list(parsed);
    } catch (error) {
      throw new CallNotesApplicationError(
        "unavailable",
        `Detected calls unavailable: ${errorMessage(error)}`
      );
    }
    const output = [];
    for (const candidate of candidates) {
      const parsedCandidate = DetectedCallCandidateSchema.parse(candidate);
      const [dismissed] = await this.options.db.select({ id: callNotesWorkItems.id }).from(callNotesWorkItems).where(
        and(
          eq(callNotesWorkItems.companyId, companyNumber2(parsed.companyId)),
          eq(callNotesWorkItems.kind, "start"),
          eq(
            callNotesWorkItems.idempotencyKey,
            `dismiss:${parsed.actorUserId}:${parsedCandidate.provider}:${parsedCandidate.occurrenceKey}`
          ),
          eq(callNotesWorkItems.status, "completed")
        )
      ).limit(1);
      if (!dismissed) output.push(Object.freeze(parsedCandidate));
      if (output.length >= parsed.limit) break;
    }
    return output;
  }
  async searchTranscript(query) {
    const parsed = TranscriptSearchQuerySchema.parse(query);
    const call = await this.getCall(parsed);
    const needle = parsed.query.toLocaleLowerCase();
    return call.transcript.filter((segment) => segment.text.toLocaleLowerCase().includes(needle));
  }
  async requireMembership(companyId, actorUserId) {
    let role;
    try {
      role = await this.options.memberships.getRole(companyId, actorUserId);
    } catch (error) {
      throw new CallNotesApplicationError(
        "unavailable",
        `Membership unavailable: ${errorMessage(error)}`
      );
    }
    if (!role)
      throw new CallNotesApplicationError("forbidden", "Company membership is required");
    return role;
  }
  async requireCallAccess(companyId, actorUserId, callId) {
    const [call] = await this.options.db.select({ id: callNotesCalls.id }).from(callNotesCalls).where(
      and(
        eq(callNotesCalls.id, callId),
        eq(callNotesCalls.companyId, companyNumber2(companyId))
      )
    ).limit(1);
    if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
    return this.requireMembership(companyId, actorUserId);
  }
  async resultFromReceipt(payload, actorUserId) {
    const resultCallId = payload.resultCallId;
    if (typeof resultCallId !== "string") return null;
    return this.snapshot(resultCallId, actorUserId);
  }
  async markReceiptFailed(id, error) {
    try {
      await this.options.db.update(callNotesWorkItems).set({
        status: "failed",
        errorCode: isApplicationError(error) ? error.code : "unavailable",
        errorMessage: errorMessage(error).slice(0, 1024)
      }).where(eq(callNotesWorkItems.id, id));
    } catch {
    }
  }
  async retryCommittedReindex(command) {
    if (command.kind !== "update_note" && command.kind !== "accept_enrichment") {
      return void 0;
    }
    const callId = command.callId;
    let revision = null;
    if (command.kind === "update_note") {
      revision = command.baseRevision + 1;
    } else {
      const [run] = await this.options.db.select({ baseNoteRevision: callNotesEnrichmentRuns.baseNoteRevision }).from(callNotesEnrichmentRuns).where(
        and(
          eq(callNotesEnrichmentRuns.id, command.enrichmentRunId),
          eq(callNotesEnrichmentRuns.callId, command.callId),
          eq(callNotesEnrichmentRuns.companyId, companyNumber2(command.companyId))
        )
      ).limit(1);
      revision = run ? run.baseNoteRevision + 1 : null;
    }
    if (revision === null) return void 0;
    const company2 = companyNumber2(command.companyId);
    const [revisionRow] = await this.options.db.select().from(callNotesNoteRevisions).where(
      and(
        eq(callNotesNoteRevisions.callId, callId),
        eq(callNotesNoteRevisions.companyId, company2),
        eq(callNotesNoteRevisions.revision, revision)
      )
    ).limit(1);
    if (!revisionRow) return void 0;
    const sameContent = revisionRow.contentMarkdown === command.contentMarkdown && JSON.stringify(revisionRow.contentRich) === JSON.stringify(command.contentRich);
    const matchesCommand = revisionRow.createdByUserId === command.actorUserId && sameContent && (command.kind === "update_note" ? revisionRow.origin === "manual" && revisionRow.title === command.title : revisionRow.origin === "enrichment" && revisionRow.enrichmentRunId === command.enrichmentRunId);
    if (!matchesCommand) return void 0;
    const [work] = await this.options.db.select().from(callNotesWorkItems).where(
      and(
        eq(callNotesWorkItems.companyId, companyNumber2(command.companyId)),
        eq(callNotesWorkItems.kind, "reindex"),
        eq(callNotesWorkItems.idempotencyKey, `reindex:${callId}:${revision}`)
      )
    ).limit(1);
    if (!work) return void 0;
    await this.processReindexWorkItem(work.id);
    return this.snapshot(callId, command.actorUserId);
  }
  async processReindexWorkItem(id) {
    let work = await this.workItems.get(id);
    if (!work || work.status === "completed") return;
    if (work.status === "failed") work = await this.workItems.reopenReceipt(id);
    const claim = await this.workItems.claimById(id, this.ids.next("reindex_worker"), {
      kind: "reindex",
      leaseMs: 5 * 6e4
    });
    if (!claim) {
      const current = await this.workItems.get(id);
      if (current?.status === "completed") return;
      throw new CallNotesApplicationError(
        "unavailable",
        "Knowledge reindex is already being processed"
      );
    }
    try {
      const callId = typeof claim.payload.callId === "string" ? claim.payload.callId : claim.callId;
      const revision = typeof claim.payload.revision === "number" ? claim.payload.revision : null;
      if (!callId || revision === null) {
        throw new CallNotesApplicationError(
          "invalid_transition",
          "Reindex work item is missing its Call revision"
        );
      }
      const [call] = await this.options.db.select().from(callNotesCalls).where(eq(callNotesCalls.id, callId)).limit(1);
      if (!call) {
        await this.workItems.complete(claim.id, claim.leaseToken);
        return;
      }
      if (call.currentNoteRevision > revision) {
        await this.workItems.complete(claim.id, claim.leaseToken);
        return;
      }
      if (call.noteVisibility === "private" || !call.knowledgeIncluded) {
        try {
          await this.options.knowledgeSink.remove(call.companyId.toString(), callId);
        } catch (error) {
          throw new CallNotesApplicationError(
            "unavailable",
            `Unable to remove knowledge Note: ${errorMessage(error)}`
          );
        }
      } else {
        const [revisionRow] = await this.options.db.select().from(callNotesNoteRevisions).where(
          and(
            eq(callNotesNoteRevisions.callId, callId),
            eq(callNotesNoteRevisions.revision, revision)
          )
        ).limit(1);
        if (!revisionRow) {
          throw new CallNotesApplicationError(
            "unavailable",
            "Committed Call Note revision is missing"
          );
        }
        await this.upsertKnowledge(
          call.companyId.toString(),
          callId,
          call,
          normalizeNote({
            id: revisionRow.documentNoteId,
            title: revisionRow.title ?? call.title,
            contentMarkdown: revisionRow.contentMarkdown,
            contentRich: revisionRow.contentRich
          }),
          revision
        );
      }
      await this.workItems.complete(claim.id, claim.leaseToken);
    } catch (error) {
      try {
        await this.workItems.fail(claim.id, claim.leaseToken, {
          code: isApplicationError(error) ? error.code : "unavailable",
          message: errorMessage(error).slice(0, 1024)
        });
      } catch {
      }
      throw error;
    }
  }
  async startCapture(command) {
    const company2 = companyNumber2(command.companyId);
    const [connection2] = await this.options.db.select({
      id: callNotesZoomConnections.id,
      zoomUserId: callNotesZoomConnections.zoomUserId
    }).from(callNotesZoomConnections).where(
      and(
        eq(callNotesZoomConnections.id, command.authorizationRef),
        eq(callNotesZoomConnections.companyId, company2),
        eq(callNotesZoomConnections.userId, command.actorUserId),
        eq(callNotesZoomConnections.status, "active")
      )
    ).limit(1);
    if (!connection2) {
      throw new CallNotesApplicationError(
        "forbidden",
        "Authorization is not an active company Zoom connection"
      );
    }
    const [existing] = await this.options.db.select().from(callNotesCalls).where(
      and(
        eq(callNotesCalls.companyId, company2),
        eq(callNotesCalls.provider, command.provider),
        eq(callNotesCalls.providerOccurrenceKey, command.occurrenceKey)
      )
    ).limit(1);
    if (existing) return this.snapshot(existing.id, command.actorUserId);
    const title = command.title ?? "Zoom call";
    let documentNote;
    try {
      documentNote = normalizeNote(
        await this.options.documentNotes.create({
          companyId: command.companyId,
          userId: command.actorUserId,
          title,
          contentMarkdown: "",
          contentRich: { ...EMPTY_RICH_TEXT }
        })
      );
    } catch (error) {
      throw new CallNotesApplicationError(
        "unavailable",
        `Unable to create Call Note: ${errorMessage(error)}`
      );
    }
    const callId = this.ids.next("call");
    const captureId = this.ids.next("capture");
    const now = this.clock.now();
    try {
      await this.options.db.transaction(async (tx) => {
        await tx.insert(callNotesCalls).values({
          id: callId,
          companyId: company2,
          provider: command.provider,
          providerOccurrenceKey: command.occurrenceKey,
          title,
          status: "active",
          documentNoteId: documentNote.id,
          noteOwnerUserId: command.actorUserId,
          noteVisibility: "company",
          knowledgeIncluded: false,
          currentNoteRevision: 0,
          startedAt: now,
          createdAt: now,
          updatedAt: now
        });
        await tx.insert(callNotesCaptures).values({
          id: captureId,
          callId,
          companyId: company2,
          captureUserConnectionId: connection2.id,
          captureUserProviderKey: connection2.zoomUserId,
          desiredMode: "running",
          lifecycle: "connecting",
          startedAt: now,
          updatedAt: now
        });
        await tx.insert(callNotesNoteRevisions).values({
          id: this.ids.next("note_revision"),
          callId,
          companyId: company2,
          documentNoteId: documentNote.id,
          revision: 0,
          origin: "manual",
          enrichmentRunId: null,
          title,
          contentMarkdown: "",
          contentRich: { ...EMPTY_RICH_TEXT },
          createdByUserId: command.actorUserId,
          createdAt: now
        });
      });
    } catch (error) {
      try {
        await this.options.documentNotes.delete(documentNote.id);
      } catch {
      }
      const [converged] = await this.options.db.select().from(callNotesCalls).where(
        and(
          eq(callNotesCalls.companyId, company2),
          eq(callNotesCalls.provider, command.provider),
          eq(callNotesCalls.providerOccurrenceKey, command.occurrenceKey)
        )
      ).limit(1);
      if (converged) return this.snapshot(converged.id, command.actorUserId);
      throw new CallNotesApplicationError(
        "unavailable",
        `Unable to persist Call: ${errorMessage(error)}`
      );
    }
    return this.snapshot(callId, command.actorUserId);
  }
  async controlCapture(command, desiredMode) {
    const company2 = companyNumber2(command.companyId);
    const [capture] = await this.options.db.select().from(callNotesCaptures).where(
      and(
        eq(callNotesCaptures.callId, command.callId),
        eq(callNotesCaptures.companyId, company2)
      )
    ).limit(1);
    if (!capture) throw new CallNotesApplicationError("not_found", "Capture not found");
    if (capture.lifecycle === "completed" || capture.lifecycle === "failed") {
      throw new CallNotesApplicationError("invalid_transition", "Capture has already ended");
    }
    await this.options.db.update(callNotesCaptures).set({ desiredMode, updatedAt: this.clock.now() }).where(eq(callNotesCaptures.id, capture.id));
    return this.snapshot(command.callId, command.actorUserId);
  }
  async updateNote(command) {
    const company2 = companyNumber2(command.companyId);
    const committed = await this.options.db.transaction(async (tx) => {
      const executor = tx;
      const [call] = await tx.select().from(callNotesCalls).where(
        and(
          eq(callNotesCalls.id, command.callId),
          eq(callNotesCalls.companyId, company2)
        )
      ).for("update").limit(1);
      if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
      if (call.noteOwnerUserId !== command.actorUserId) {
        throw new CallNotesApplicationError(
          "forbidden",
          "Only the Call Note owner may edit it"
        );
      }
      if (call.documentNoteId === null)
        throw new CallNotesApplicationError("invalid_transition", "Call has no Note");
      if (call.currentNoteRevision !== command.baseRevision) {
        throw new CallNotesApplicationError("conflict", "Call Note revision is stale");
      }
      let updatedNote;
      try {
        const existing = await this.options.documentNotes.get(
          call.documentNoteId,
          executor
        );
        if (!existing)
          throw new CallNotesApplicationError("not_found", "Document Note not found");
        updatedNote = normalizeNote(
          await this.options.documentNotes.update(
            call.documentNoteId,
            {
              title: command.title,
              contentMarkdown: command.contentMarkdown,
              contentRich: command.contentRich
            },
            executor
          )
        );
      } catch (error) {
        if (isApplicationError(error)) throw error;
        throw new CallNotesApplicationError(
          "unavailable",
          `Unable to update Call Note: ${errorMessage(error)}`
        );
      }
      const revision = command.baseRevision + 1;
      const now = this.clock.now();
      const [updated] = await tx.update(callNotesCalls).set({ currentNoteRevision: revision, updatedAt: now }).where(
        and(
          eq(callNotesCalls.id, command.callId),
          eq(callNotesCalls.companyId, company2),
          eq(callNotesCalls.currentNoteRevision, command.baseRevision)
        )
      ).returning();
      if (!updated)
        throw new CallNotesApplicationError("conflict", "Call Note revision is stale");
      await tx.insert(callNotesNoteRevisions).values({
        id: this.ids.next("note_revision"),
        callId: command.callId,
        companyId: company2,
        documentNoteId: call.documentNoteId,
        revision,
        origin: "manual",
        enrichmentRunId: null,
        title: command.title,
        contentMarkdown: command.contentMarkdown,
        contentRich: command.contentRich,
        createdByUserId: command.actorUserId,
        createdAt: now
      });
      const reindex = call.knowledgeIncluded && call.noteVisibility === "company" ? await this.workItems.enqueue(
        {
          companyId: command.companyId,
          callId: command.callId,
          kind: "reindex",
          idempotencyKey: `reindex:${command.callId}:${revision}`,
          payload: {
            callId: command.callId,
            revision
          }
        },
        tx
      ) : null;
      return { call: updated, note: updatedNote, revision, reindexId: reindex?.id ?? null };
    });
    if (committed.reindexId) await this.processReindexWorkItem(committed.reindexId);
    return this.snapshot(command.callId, command.actorUserId);
  }
  async addBookmark(command) {
    const company2 = companyNumber2(command.companyId);
    const [call] = await this.options.db.select({ noteOwnerUserId: callNotesCalls.noteOwnerUserId }).from(callNotesCalls).where(
      and(eq(callNotesCalls.id, command.callId), eq(callNotesCalls.companyId, company2))
    ).limit(1);
    if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
    if (call.noteOwnerUserId !== command.actorUserId) {
      throw new CallNotesApplicationError(
        "forbidden",
        "Only the Call Note owner may add bookmarks"
      );
    }
    const [segment] = await this.options.db.select({ id: callNotesTranscriptSegments.id }).from(callNotesTranscriptSegments).where(
      and(
        eq(callNotesTranscriptSegments.id, command.segmentId),
        eq(callNotesTranscriptSegments.callId, command.callId),
        eq(callNotesTranscriptSegments.companyId, company2)
      )
    ).limit(1);
    if (!segment)
      throw new CallNotesApplicationError("not_found", "Transcript segment not found");
    await this.options.db.insert(callNotesBookmarks).values({
      id: this.ids.next("bookmark"),
      callId: command.callId,
      segmentId: command.segmentId,
      companyId: company2,
      createdByUserId: command.actorUserId,
      comment: command.comment,
      createdAt: this.clock.now()
    });
    return this.snapshot(command.callId, command.actorUserId);
  }
  async setNoteVisibility(command) {
    const company2 = companyNumber2(command.companyId);
    const [call] = await this.options.db.select().from(callNotesCalls).where(
      and(eq(callNotesCalls.id, command.callId), eq(callNotesCalls.companyId, company2))
    ).limit(1);
    if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
    if (call.noteOwnerUserId !== command.actorUserId) {
      throw new CallNotesApplicationError(
        "forbidden",
        "Only the Call Note owner may change visibility"
      );
    }
    await this.options.db.update(callNotesCalls).set({
      noteVisibility: command.visibility,
      knowledgeIncluded: command.visibility === "private" ? false : call.knowledgeIncluded,
      updatedAt: this.clock.now()
    }).where(
      and(eq(callNotesCalls.id, command.callId), eq(callNotesCalls.companyId, company2))
    );
    if (command.visibility === "private") {
      try {
        await this.options.knowledgeSink.remove(command.companyId, command.callId);
      } catch (error) {
        throw new CallNotesApplicationError(
          "unavailable",
          `Unable to remove knowledge Note: ${errorMessage(error)}`
        );
      }
    }
    return this.snapshot(command.callId, command.actorUserId);
  }
  async requestEnrichment(command) {
    const company2 = companyNumber2(command.companyId);
    const [call] = await this.options.db.select().from(callNotesCalls).where(
      and(eq(callNotesCalls.id, command.callId), eq(callNotesCalls.companyId, company2))
    ).limit(1);
    if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
    if (call.noteOwnerUserId !== command.actorUserId) {
      throw new CallNotesApplicationError(
        "forbidden",
        "Only the Call Note owner may request enrichment"
      );
    }
    if (call.documentNoteId === null)
      throw new CallNotesApplicationError("invalid_transition", "Call has no Note");
    const [active] = await this.options.db.select({ id: callNotesEnrichmentRuns.id }).from(callNotesEnrichmentRuns).where(
      and(
        eq(callNotesEnrichmentRuns.callId, command.callId),
        sql`${callNotesEnrichmentRuns.status} in ('queued', 'generating', 'ready')`
      )
    ).orderBy(desc(callNotesEnrichmentRuns.createdAt)).limit(1);
    if (active) return this.snapshot(command.callId, command.actorUserId);
    const transcriptRows = await this.transcriptRows(command.callId, company2);
    const participants = await this.options.db.select().from(callNotesParticipants).where(eq(callNotesParticipants.callId, command.callId));
    const transcript = toTranscriptSegments(transcriptRows, participants);
    const gapRows = await this.options.db.select().from(callNotesGaps).where(eq(callNotesGaps.callId, command.callId)).orderBy(asc(callNotesGaps.startedAt), asc(callNotesGaps.id));
    const bookmarkRows = await this.options.db.select().from(callNotesBookmarks).where(eq(callNotesBookmarks.callId, command.callId)).orderBy(asc(callNotesBookmarks.createdAt), asc(callNotesBookmarks.id));
    const documentNote = await this.options.documentNotes.get(call.documentNoteId);
    if (!documentNote)
      throw new CallNotesApplicationError("not_found", "Document Note not found");
    const fingerprint = enrichmentFingerprint({
      transcript,
      gaps: toGaps(gapRows),
      bookmarks: toBookmarks(bookmarkRows),
      note: toCallNote(call, documentNote)
    });
    await this.options.db.insert(callNotesEnrichmentRuns).values({
      id: this.ids.next("enrichment"),
      callId: command.callId,
      companyId: company2,
      requestedByUserId: command.actorUserId,
      baseNoteRevision: call.currentNoteRevision,
      transcriptFingerprint: fingerprint,
      status: "queued",
      originalOutput: null,
      editableProposal: null,
      modelMetadata: null,
      createdAt: this.clock.now()
    });
    return this.snapshot(command.callId, command.actorUserId);
  }
  async rejectEnrichment(command) {
    const company2 = companyNumber2(command.companyId);
    await this.options.db.transaction(async (tx) => {
      const [call] = await tx.select().from(callNotesCalls).where(
        and(
          eq(callNotesCalls.id, command.callId),
          eq(callNotesCalls.companyId, company2)
        )
      ).for("update").limit(1);
      if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
      if (call.noteOwnerUserId !== command.actorUserId) {
        throw new CallNotesApplicationError(
          "forbidden",
          "Only the Call Note owner may reject enrichment"
        );
      }
      const [run] = await tx.select().from(callNotesEnrichmentRuns).where(
        and(
          eq(callNotesEnrichmentRuns.id, command.enrichmentRunId),
          eq(callNotesEnrichmentRuns.callId, command.callId),
          eq(callNotesEnrichmentRuns.companyId, company2)
        )
      ).for("update").limit(1);
      if (!run) throw new CallNotesApplicationError("not_found", "Enrichment run not found");
      if (run.status !== "ready") {
        throw new CallNotesApplicationError(
          run.status === "accepted" || run.status === "rejected" ? "conflict" : "invalid_transition",
          "Enrichment is not reviewable"
        );
      }
      const [resolved] = await tx.update(callNotesEnrichmentRuns).set({
        status: "rejected",
        resolvedByUserId: command.actorUserId,
        resolvedAt: this.clock.now()
      }).where(
        and(
          eq(callNotesEnrichmentRuns.id, command.enrichmentRunId),
          eq(callNotesEnrichmentRuns.status, "ready")
        )
      ).returning();
      if (!resolved)
        throw new CallNotesApplicationError(
          "conflict",
          "Enrichment was resolved by another request"
        );
    });
    return this.snapshot(command.callId, command.actorUserId);
  }
  async acceptEnrichment(command) {
    const company2 = companyNumber2(command.companyId);
    const committed = await this.options.db.transaction(async (tx) => {
      const executor = tx;
      const [call] = await tx.select().from(callNotesCalls).where(
        and(
          eq(callNotesCalls.id, command.callId),
          eq(callNotesCalls.companyId, company2)
        )
      ).for("update").limit(1);
      if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
      if (call.noteOwnerUserId !== command.actorUserId) {
        throw new CallNotesApplicationError(
          "forbidden",
          "Only the Call Note owner may accept enrichment"
        );
      }
      const [run] = await tx.select().from(callNotesEnrichmentRuns).where(
        and(
          eq(callNotesEnrichmentRuns.id, command.enrichmentRunId),
          eq(callNotesEnrichmentRuns.callId, command.callId),
          eq(callNotesEnrichmentRuns.companyId, company2)
        )
      ).for("update").limit(1);
      if (!run) throw new CallNotesApplicationError("not_found", "Enrichment run not found");
      if (run.status === "accepted") {
        const [acceptedRevision] = await tx.select().from(callNotesNoteRevisions).where(
          and(
            eq(callNotesNoteRevisions.callId, command.callId),
            eq(callNotesNoteRevisions.enrichmentRunId, run.id)
          )
        ).limit(1);
        if (!acceptedRevision || acceptedRevision.contentMarkdown !== command.contentMarkdown || !isDeepStrictEqual(acceptedRevision.contentRich, command.contentRich)) {
          throw new CallNotesApplicationError(
            "conflict",
            "Accepted enrichment content does not match the committed revision"
          );
        }
        const reindex2 = call.knowledgeIncluded && call.noteVisibility === "company" ? await this.workItems.enqueue(
          {
            companyId: command.companyId,
            callId: command.callId,
            kind: "reindex",
            idempotencyKey: `reindex:${command.callId}:${acceptedRevision.revision}`,
            payload: {
              callId: command.callId,
              revision: acceptedRevision.revision
            }
          },
          tx
        ) : null;
        return { reindexId: reindex2?.id ?? null };
      }
      if (run.status !== "ready") {
        throw new CallNotesApplicationError(
          run.status === "rejected" ? "conflict" : "invalid_transition",
          "Enrichment is not reviewable"
        );
      }
      if (call.documentNoteId === null)
        throw new CallNotesApplicationError("not_found", "Call Note not found");
      if (run.baseNoteRevision !== call.currentNoteRevision) {
        throw new CallNotesApplicationError(
          "conflict",
          "Enrichment was generated from a stale Note revision"
        );
      }
      let note;
      try {
        const existing = await this.options.documentNotes.get(
          call.documentNoteId,
          executor
        );
        if (!existing)
          throw new CallNotesApplicationError("not_found", "Document Note not found");
        note = normalizeNote(
          await this.options.documentNotes.update(
            call.documentNoteId,
            {
              title: existing.title,
              contentMarkdown: command.contentMarkdown,
              contentRich: command.contentRich
            },
            executor
          )
        );
      } catch (error) {
        if (isApplicationError(error)) throw error;
        throw new CallNotesApplicationError(
          "unavailable",
          `Unable to update Call Note: ${errorMessage(error)}`
        );
      }
      const revision = call.currentNoteRevision + 1;
      const now = this.clock.now();
      const [updated] = await tx.update(callNotesCalls).set({ currentNoteRevision: revision, updatedAt: now }).where(
        and(
          eq(callNotesCalls.id, command.callId),
          eq(callNotesCalls.companyId, company2),
          eq(callNotesCalls.currentNoteRevision, call.currentNoteRevision)
        )
      ).returning();
      if (!updated)
        throw new CallNotesApplicationError("conflict", "Call Note revision is stale");
      await tx.insert(callNotesNoteRevisions).values({
        id: this.ids.next("note_revision"),
        callId: command.callId,
        companyId: company2,
        documentNoteId: call.documentNoteId,
        revision,
        origin: "enrichment",
        enrichmentRunId: run.id,
        title: note.title,
        contentMarkdown: command.contentMarkdown,
        contentRich: command.contentRich,
        createdByUserId: command.actorUserId,
        createdAt: now
      });
      const [resolved] = await tx.update(callNotesEnrichmentRuns).set({
        status: "accepted",
        resolvedByUserId: command.actorUserId,
        resolvedAt: now
      }).where(
        and(
          eq(callNotesEnrichmentRuns.id, run.id),
          eq(callNotesEnrichmentRuns.status, "ready")
        )
      ).returning();
      if (!resolved)
        throw new CallNotesApplicationError(
          "conflict",
          "Enrichment was resolved by another request"
        );
      const reindex = call.knowledgeIncluded && call.noteVisibility === "company" ? await this.workItems.enqueue(
        {
          companyId: command.companyId,
          callId: command.callId,
          kind: "reindex",
          idempotencyKey: `reindex:${command.callId}:${revision}`,
          payload: {
            callId: command.callId,
            revision
          }
        },
        tx
      ) : null;
      return { reindexId: reindex?.id ?? null };
    });
    if (committed.reindexId) await this.processReindexWorkItem(committed.reindexId);
    return this.snapshot(command.callId, command.actorUserId);
  }
  async setKnowledgeInclusion(command) {
    const company2 = companyNumber2(command.companyId);
    const [call] = await this.options.db.select().from(callNotesCalls).where(
      and(eq(callNotesCalls.id, command.callId), eq(callNotesCalls.companyId, company2))
    ).limit(1);
    if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
    if (call.noteOwnerUserId !== command.actorUserId) {
      throw new CallNotesApplicationError(
        "forbidden",
        "Only the Call Note owner may change knowledge inclusion"
      );
    }
    if (command.included && call.noteVisibility === "private") {
      throw new CallNotesApplicationError(
        "forbidden",
        "Private Call Notes cannot enter company knowledge"
      );
    }
    if (call.documentNoteId === null || !call.noteOwnerUserId) {
      throw new CallNotesApplicationError("invalid_transition", "Call has no indexable Note");
    }
    const note = await this.options.documentNotes.get(call.documentNoteId);
    if (!note) throw new CallNotesApplicationError("not_found", "Document Note not found");
    if (command.included && call.currentNoteRevision <= 0) {
      throw new CallNotesApplicationError(
        "invalid_transition",
        "A saved Note revision is required before indexing"
      );
    }
    await this.options.db.update(callNotesCalls).set({ knowledgeIncluded: command.included, updatedAt: this.clock.now() }).where(eq(callNotesCalls.id, command.callId));
    if (command.included) {
      await this.upsertKnowledge(
        command.companyId,
        command.callId,
        call,
        normalizeNote(note),
        call.currentNoteRevision
      );
    } else {
      try {
        await this.options.knowledgeSink.remove(command.companyId, command.callId);
      } catch (error) {
        throw new CallNotesApplicationError(
          "unavailable",
          `Unable to remove knowledge Note: ${errorMessage(error)}`
        );
      }
    }
    return this.snapshot(command.callId, command.actorUserId);
  }
  async upsertKnowledge(companyId, callId, call, note, revision) {
    if (call.documentNoteId === null || !call.noteOwnerUserId) {
      throw new CallNotesApplicationError("invalid_transition", "Call has no indexable Note");
    }
    try {
      await this.options.knowledgeSink.upsert({
        companyId,
        callId,
        documentNoteId: call.documentNoteId,
        ownerUserId: call.noteOwnerUserId,
        revision,
        title: note.title,
        contentMarkdown: note.contentMarkdown,
        deepLink: this.deepLink(companyId, callId)
      });
    } catch (error) {
      throw new CallNotesApplicationError(
        "unavailable",
        `Unable to update knowledge Note: ${errorMessage(error)}`
      );
    }
  }
  async deleteCall(command) {
    const company2 = companyNumber2(command.companyId);
    const role = await this.requireMembership(command.companyId, command.actorUserId);
    const [call] = await this.options.db.select().from(callNotesCalls).where(
      and(eq(callNotesCalls.id, command.callId), eq(callNotesCalls.companyId, company2))
    ).limit(1);
    if (!call) {
      try {
        await this.options.knowledgeSink.remove(command.companyId, command.callId);
      } catch (error) {
        throw new CallNotesApplicationError(
          "unavailable",
          `Unable to remove knowledge Note: ${errorMessage(error)}`
        );
      }
      return null;
    }
    const transcript = await this.options.db.select({ id: callNotesTranscriptSegments.id }).from(callNotesTranscriptSegments).where(eq(callNotesTranscriptSegments.callId, command.callId)).limit(1);
    if (role !== "admin" && (role !== "owner" || call.status !== "failed" || transcript.length > 0)) {
      throw new CallNotesApplicationError("forbidden", "Only admins may delete this Call");
    }
    try {
      await this.options.knowledgeSink.remove(command.companyId, command.callId);
    } catch (error) {
      throw new CallNotesApplicationError(
        "unavailable",
        `Unable to remove knowledge Note: ${errorMessage(error)}`
      );
    }
    if (call.documentNoteId !== null) {
      try {
        await this.options.documentNotes.delete(call.documentNoteId);
      } catch (error) {
        throw new CallNotesApplicationError(
          "unavailable",
          `Unable to delete Call Note: ${errorMessage(error)}`
        );
      }
    }
    await this.options.db.delete(callNotesCalls).where(
      and(eq(callNotesCalls.id, command.callId), eq(callNotesCalls.companyId, company2))
    );
    return null;
  }
  async applyCaptureEvent(callId, company2, event) {
    const [capture] = await this.options.db.select().from(callNotesCaptures).where(
      and(eq(callNotesCaptures.callId, callId), eq(callNotesCaptures.companyId, company2))
    ).limit(1);
    if (!capture) {
      throw new CallNotesApplicationError("unavailable", "Call capture is missing");
    }
    if ((capture.lifecycle === "completed" || capture.lifecycle === "failed") && event.kind !== "transcript_segment" && event.kind !== "occurrence_ended") {
      return;
    }
    const occurredAt = asDate(event.occurredAt);
    switch (event.kind) {
      case "attempt_connected":
        await this.attemptConnected(callId, company2, capture, event, occurredAt);
        return;
      case "attempt_paused":
        await this.openGap(
          callId,
          company2,
          capture.id,
          event.attemptKey,
          "user_paused",
          occurredAt
        );
        await this.options.db.update(callNotesCaptures).set({ desiredMode: "paused", lifecycle: "interrupted", updatedAt: occurredAt }).where(eq(callNotesCaptures.id, capture.id));
        return;
      case "attempt_resumed":
        await this.closeGap(callId, "user_paused", event.attemptKey, occurredAt);
        await this.options.db.update(callNotesCaptures).set({ desiredMode: "running", lifecycle: "live", updatedAt: occurredAt }).where(eq(callNotesCaptures.id, capture.id));
        return;
      case "transport_interrupted":
        await this.openGap(
          callId,
          company2,
          capture.id,
          event.attemptKey,
          "transport_interruption",
          occurredAt
        );
        await this.options.db.update(callNotesCaptureAttempts).set({ lifecycle: "reconnecting" }).where(
          and(
            eq(callNotesCaptureAttempts.captureId, capture.id),
            eq(callNotesCaptureAttempts.providerAttemptKey, event.attemptKey)
          )
        );
        await this.options.db.update(callNotesCaptures).set({ lifecycle: "interrupted", updatedAt: occurredAt }).where(eq(callNotesCaptures.id, capture.id));
        return;
      case "transport_reconnected":
        await this.closeGap(callId, "transport_interruption", event.attemptKey, occurredAt);
        await this.options.db.update(callNotesCaptureAttempts).set({ lifecycle: "live" }).where(
          and(
            eq(callNotesCaptureAttempts.captureId, capture.id),
            eq(callNotesCaptureAttempts.providerAttemptKey, event.attemptKey)
          )
        );
        await this.options.db.update(callNotesCaptures).set({ lifecycle: "live", updatedAt: occurredAt }).where(eq(callNotesCaptures.id, capture.id));
        return;
      case "attempt_ended":
        await this.options.db.update(callNotesCaptureAttempts).set({ lifecycle: "ended", endedAt: occurredAt }).where(
          and(
            eq(callNotesCaptureAttempts.captureId, capture.id),
            eq(callNotesCaptureAttempts.providerAttemptKey, event.attemptKey)
          )
        );
        if (event.reason === "capture_user_left") {
          await this.openGap(
            callId,
            company2,
            capture.id,
            event.attemptKey,
            "capture_user_absent",
            occurredAt
          );
        }
        await this.options.db.update(callNotesCaptures).set({ activeAttemptId: null, lifecycle: "interrupted", updatedAt: occurredAt }).where(eq(callNotesCaptures.id, capture.id));
        return;
      case "attempt_failed":
        await this.options.db.update(callNotesCaptureAttempts).set({
          lifecycle: "failed",
          endedAt: occurredAt,
          failureCode: event.code,
          failureMessage: event.message
        }).where(
          and(
            eq(callNotesCaptureAttempts.captureId, capture.id),
            eq(callNotesCaptureAttempts.providerAttemptKey, event.attemptKey)
          )
        );
        await this.openGap(
          callId,
          company2,
          capture.id,
          event.attemptKey,
          "provider_unknown",
          occurredAt
        );
        await this.options.db.update(callNotesCaptures).set({ activeAttemptId: null, lifecycle: "failed", updatedAt: occurredAt }).where(eq(callNotesCaptures.id, capture.id));
        return;
      case "participant_joined":
      case "participant_returned":
        await this.participantObserved(callId, company2, capture.id, event, occurredAt);
        if (event.kind === "participant_returned" && event.participant.providerParticipantKey === capture.captureUserProviderKey) {
          await this.closeGap(
            callId,
            "capture_user_absent",
            event.attemptKey,
            occurredAt
          );
        }
        return;
      case "participant_left":
        await this.participantLeft(capture.id, event, occurredAt);
        if (event.participant.providerParticipantKey === capture.captureUserProviderKey) {
          await this.openGap(
            callId,
            company2,
            capture.id,
            event.attemptKey,
            "capture_user_absent",
            occurredAt
          );
        }
        return;
      case "transcript_segment":
        await this.transcriptSegment(callId, company2, capture, event);
        return;
      case "occurrence_ended":
        await this.finalizeOccurrence(callId, company2, capture, occurredAt);
        return;
      default:
        throw new CallNotesApplicationError(
          "invalid_transition",
          "Unsupported capture event"
        );
    }
  }
  async attemptConnected(callId, company2, capture, event, occurredAt) {
    const [existing] = await this.options.db.select().from(callNotesCaptureAttempts).where(
      and(
        eq(callNotesCaptureAttempts.captureId, capture.id),
        eq(callNotesCaptureAttempts.providerAttemptKey, event.attemptKey)
      )
    ).limit(1);
    if (existing) {
      if (!isActiveAttemptLifecycle(existing.lifecycle)) return;
      await this.options.db.update(callNotesCaptures).set({ activeAttemptId: existing.id, lifecycle: "live", updatedAt: occurredAt }).where(eq(callNotesCaptures.id, capture.id));
      return;
    }
    const [active] = await this.options.db.select().from(callNotesCaptureAttempts).where(
      and(
        eq(callNotesCaptureAttempts.captureId, capture.id),
        sql`${callNotesCaptureAttempts.lifecycle} in ('connecting', 'live', 'reconnecting')`
      )
    ).limit(1);
    if (active) {
      await this.options.db.update(callNotesCaptureAttempts).set({ lifecycle: "ended", endedAt: occurredAt }).where(eq(callNotesCaptureAttempts.id, active.id));
    }
    const attemptId = this.ids.next("attempt");
    await this.options.db.insert(callNotesCaptureAttempts).values({
      id: attemptId,
      captureId: capture.id,
      callId,
      companyId: company2,
      providerAttemptKey: event.attemptKey,
      providerStreamKey: event.streamKey,
      lifecycle: "live",
      startedAt: occurredAt
    });
    await this.closeGap(callId, "capture_user_absent", event.attemptKey, occurredAt);
    await this.options.db.update(callNotesCaptures).set({ activeAttemptId: attemptId, lifecycle: "live", updatedAt: occurredAt }).where(eq(callNotesCaptures.id, capture.id));
  }
  async participantObserved(callId, company2, captureId, event, occurredAt) {
    const [attempt] = await this.options.db.select({ id: callNotesCaptureAttempts.id }).from(callNotesCaptureAttempts).where(
      and(
        eq(callNotesCaptureAttempts.captureId, captureId),
        eq(callNotesCaptureAttempts.providerAttemptKey, event.attemptKey)
      )
    ).limit(1);
    if (!attempt) return;
    const [existing] = await this.options.db.select({ id: callNotesParticipants.id }).from(callNotesParticipants).where(
      and(
        eq(callNotesParticipants.attemptId, attempt.id),
        eq(
          callNotesParticipants.providerParticipantKey,
          event.participant.providerParticipantKey
        ),
        ...event.participant.providerSessionKey ? [
          eq(
            callNotesParticipants.providerSessionKey,
            event.participant.providerSessionKey
          )
        ] : [],
        eq(callNotesParticipants.observedAt, occurredAt)
      )
    ).limit(1);
    if (existing) return;
    await this.options.db.insert(callNotesParticipants).values({
      id: this.ids.next("participant"),
      callId,
      attemptId: attempt.id,
      companyId: company2,
      providerParticipantKey: event.participant.providerParticipantKey,
      providerSessionKey: event.participant.providerSessionKey,
      displayName: event.participant.displayName,
      observedAt: occurredAt,
      leftAt: null
    });
  }
  async participantLeft(captureId, event, occurredAt) {
    const [attempt] = await this.options.db.select({ id: callNotesCaptureAttempts.id }).from(callNotesCaptureAttempts).where(
      and(
        eq(callNotesCaptureAttempts.captureId, captureId),
        eq(callNotesCaptureAttempts.providerAttemptKey, event.attemptKey)
      )
    ).limit(1);
    if (!attempt) return;
    const [participant] = await this.options.db.select({ id: callNotesParticipants.id }).from(callNotesParticipants).where(
      and(
        eq(callNotesParticipants.attemptId, attempt.id),
        eq(
          callNotesParticipants.providerParticipantKey,
          event.participant.providerParticipantKey
        ),
        ...event.participant.providerSessionKey ? [
          eq(
            callNotesParticipants.providerSessionKey,
            event.participant.providerSessionKey
          )
        ] : [],
        isNull(callNotesParticipants.leftAt)
      )
    ).orderBy(desc(callNotesParticipants.observedAt)).limit(1);
    if (participant) {
      await this.options.db.update(callNotesParticipants).set({ leftAt: occurredAt }).where(eq(callNotesParticipants.id, participant.id));
    }
  }
  async transcriptSegment(callId, company2, capture, event) {
    let [attempt] = await this.options.db.select().from(callNotesCaptureAttempts).where(
      and(
        eq(callNotesCaptureAttempts.captureId, capture.id),
        eq(callNotesCaptureAttempts.providerAttemptKey, event.attemptKey)
      )
    ).limit(1);
    if (!attempt) {
      const attemptId = this.ids.next("attempt");
      [attempt] = await this.options.db.insert(callNotesCaptureAttempts).values({
        id: attemptId,
        captureId: capture.id,
        callId,
        companyId: company2,
        providerAttemptKey: event.attemptKey,
        providerStreamKey: null,
        lifecycle: "live",
        startedAt: asDate(event.occurredAt)
      }).returning();
    }
    if (!attempt)
      throw new CallNotesApplicationError("unavailable", "Unable to create capture attempt");
    let participantId = null;
    if (event.participant) {
      const [participant] = await this.options.db.select({ id: callNotesParticipants.id }).from(callNotesParticipants).where(
        and(
          eq(callNotesParticipants.attemptId, attempt.id),
          eq(
            callNotesParticipants.providerParticipantKey,
            event.participant.providerParticipantKey
          ),
          ...event.participant.providerSessionKey ? [
            eq(
              callNotesParticipants.providerSessionKey,
              event.participant.providerSessionKey
            )
          ] : []
        )
      ).orderBy(desc(callNotesParticipants.observedAt)).limit(1);
      if (participant) participantId = participant.id;
      else {
        const createdId = this.ids.next("participant");
        await this.options.db.insert(callNotesParticipants).values({
          id: createdId,
          callId,
          attemptId: attempt.id,
          companyId: company2,
          providerParticipantKey: event.participant.providerParticipantKey,
          providerSessionKey: event.participant.providerSessionKey,
          displayName: event.participant.displayName,
          observedAt: asDate(event.occurredAt),
          leftAt: null
        });
        participantId = createdId;
      }
    }
    const [inserted] = await this.options.db.insert(callNotesTranscriptSegments).values({
      id: this.ids.next("segment"),
      callId,
      attemptId: attempt.id,
      participantId,
      companyId: company2,
      providerEventKey: event.providerEventKey,
      sourcePacketHash: event.sourcePacketHash,
      sourceKind: event.sourceKind,
      speakerName: event.participant?.displayName ?? null,
      providerStartMs: event.providerStartMs ?? null,
      providerEndMs: event.providerEndMs ?? null,
      receivedAt: asDate(event.receivedAt),
      receiveOrder: event.receiveOrder,
      text: event.text,
      language: event.language ?? null,
      createdAt: this.clock.now()
    }).onConflictDoNothing({
      target: [
        callNotesTranscriptSegments.attemptId,
        callNotesTranscriptSegments.sourcePacketHash
      ]
    }).returning({ id: callNotesTranscriptSegments.id });
    if (inserted && (capture.lifecycle === "completed" || capture.lifecycle === "failed")) {
      await this.finalizeOccurrence(
        callId,
        company2,
        capture,
        capture.endedAt ?? asDate(event.occurredAt)
      );
    }
  }
  async openGap(callId, company2, captureId, attemptKey, kind, startedAt) {
    let attemptId = null;
    if (attemptKey) {
      const [attempt] = await this.options.db.select({ id: callNotesCaptureAttempts.id }).from(callNotesCaptureAttempts).where(
        and(
          eq(callNotesCaptureAttempts.captureId, captureId),
          eq(callNotesCaptureAttempts.providerAttemptKey, attemptKey)
        )
      ).limit(1);
      attemptId = attempt?.id ?? null;
    }
    const [open] = await this.options.db.select({ id: callNotesGaps.id }).from(callNotesGaps).where(
      and(
        eq(callNotesGaps.callId, callId),
        eq(callNotesGaps.kind, kind),
        isNull(callNotesGaps.endedAt),
        attemptId ? eq(callNotesGaps.attemptId, attemptId) : sql`true`
      )
    ).limit(1);
    if (open) return;
    await this.options.db.insert(callNotesGaps).values({
      id: this.ids.next("gap"),
      callId,
      captureId,
      attemptId,
      companyId: company2,
      kind,
      startedAt,
      endedAt: null,
      details: null
    });
  }
  async closeGap(callId, kind, attemptKey, endedAt) {
    const predicates = [
      eq(callNotesGaps.callId, callId),
      eq(callNotesGaps.kind, kind),
      isNull(callNotesGaps.endedAt)
    ];
    if (attemptKey) {
      const [attempt] = await this.options.db.select({ id: callNotesCaptureAttempts.id }).from(callNotesCaptureAttempts).where(
        and(
          eq(callNotesCaptureAttempts.callId, callId),
          eq(callNotesCaptureAttempts.providerAttemptKey, attemptKey)
        )
      ).limit(1);
      if (!attempt) return;
      predicates.push(eq(callNotesGaps.attemptId, attempt.id));
    }
    await this.options.db.update(callNotesGaps).set({ endedAt }).where(and(...predicates));
  }
  async finalizeOccurrence(callId, company2, capture, endedAt) {
    const gaps = await this.options.db.select().from(callNotesGaps).where(eq(callNotesGaps.callId, callId));
    await this.options.db.update(callNotesGaps).set({ endedAt }).where(and(eq(callNotesGaps.callId, callId), isNull(callNotesGaps.endedAt)));
    const attempts = await this.options.db.select().from(callNotesCaptureAttempts).where(eq(callNotesCaptureAttempts.captureId, capture.id));
    const segments = await this.options.db.select({ id: callNotesTranscriptSegments.id }).from(callNotesTranscriptSegments).where(eq(callNotesTranscriptSegments.callId, callId));
    const hasGap = gaps.length > 0;
    const allAttemptsFailed = attempts.length > 0 && attempts.every((attempt) => attempt.lifecycle === "failed");
    const outcome = allAttemptsFailed && segments.length === 0 ? "failed" : hasGap ? "partial" : "complete";
    const status = outcome === "failed" ? "failed" : "completed";
    await this.options.db.update(callNotesCaptureAttempts).set({
      lifecycle: "ended",
      endedAt
    }).where(
      and(
        eq(callNotesCaptureAttempts.captureId, capture.id),
        sql`${callNotesCaptureAttempts.lifecycle} in ('connecting', 'live', 'reconnecting')`
      )
    );
    await this.options.db.update(callNotesCaptures).set({
      activeAttemptId: null,
      lifecycle: outcome === "failed" ? "failed" : "completed",
      outcome,
      endedAt,
      updatedAt: endedAt
    }).where(eq(callNotesCaptures.id, capture.id));
    await this.options.db.update(callNotesCalls).set({ status, finalizedAt: endedAt, updatedAt: endedAt }).where(and(eq(callNotesCalls.id, callId), eq(callNotesCalls.companyId, company2)));
    if (segments.length === 0 && outcome === "complete") {
      await this.options.db.update(callNotesCalls).set({
        status: "failed",
        failureCode: "empty_capture",
        failureMessage: "No transcript evidence",
        updatedAt: endedAt
      }).where(eq(callNotesCalls.id, callId));
      await this.options.db.update(callNotesCaptures).set({ lifecycle: "failed", outcome: "failed" }).where(eq(callNotesCaptures.id, capture.id));
    }
  }
  async transcriptRows(callId, company2) {
    const rows = await this.options.db.select().from(callNotesTranscriptSegments).where(
      and(
        eq(callNotesTranscriptSegments.callId, callId),
        eq(callNotesTranscriptSegments.companyId, company2)
      )
    );
    return sortTranscriptRows(rows);
  }
  async snapshot(callId, actorUserId) {
    const [call] = await this.options.db.select().from(callNotesCalls).where(eq(callNotesCalls.id, callId)).limit(1);
    if (!call) throw new CallNotesApplicationError("not_found", "Call not found");
    const [capture] = await this.options.db.select().from(callNotesCaptures).where(eq(callNotesCaptures.callId, call.id)).limit(1);
    if (!capture) throw new CallNotesApplicationError("unavailable", "Call capture is missing");
    const attempts = await this.options.db.select({ id: callNotesCaptureAttempts.id }).from(callNotesCaptureAttempts).where(eq(callNotesCaptureAttempts.captureId, capture.id));
    const rows = await this.transcriptRows(call.id, call.companyId);
    const participants = await this.options.db.select().from(callNotesParticipants).where(eq(callNotesParticipants.callId, call.id));
    const transcript = toTranscriptSegments(rows, participants);
    const membershipRole = await this.options.memberships.getRole(
      call.companyId.toString(),
      actorUserId
    );
    if (!membershipRole) {
      throw new CallNotesApplicationError("not_found", "Call not found");
    }
    const [captureConnection] = await this.options.db.select({ userId: callNotesZoomConnections.userId }).from(callNotesZoomConnections).where(eq(callNotesZoomConnections.id, capture.captureUserConnectionId)).limit(1);
    const isNoteOwner = call.noteOwnerUserId === actorUserId;
    const isCaptureUser = captureConnection?.userId === actorUserId;
    const isCompanyAdmin = membershipRole === "owner" || membershipRole === "admin";
    const canDelete = isCompanyAdmin || isNoteOwner && call.status === "failed" && rows.length === 0;
    const gapRows = await this.options.db.select().from(callNotesGaps).where(eq(callNotesGaps.callId, call.id)).orderBy(asc(callNotesGaps.startedAt), asc(callNotesGaps.id));
    const bookmarkRows = await this.options.db.select().from(callNotesBookmarks).where(eq(callNotesBookmarks.callId, call.id)).orderBy(asc(callNotesBookmarks.createdAt), asc(callNotesBookmarks.id));
    const runRows = await this.options.db.select().from(callNotesEnrichmentRuns).where(eq(callNotesEnrichmentRuns.callId, call.id)).orderBy(desc(callNotesEnrichmentRuns.createdAt), desc(callNotesEnrichmentRuns.id)).limit(1);
    let note = null;
    if (call.documentNoteId !== null && call.noteOwnerUserId && (call.noteVisibility === "company" || call.noteOwnerUserId === actorUserId)) {
      const documentNote = await this.options.documentNotes.get(call.documentNoteId);
      if (documentNote) {
        note = toCallNote(call, documentNote);
      }
    }
    const run = runRows[0];
    const canViewEnrichment = call.noteVisibility === "company" || call.noteOwnerUserId === actorUserId;
    const enrichment = run && canViewEnrichment ? {
      id: run.id,
      status: run.status,
      baseNoteRevision: run.baseNoteRevision,
      transcriptFingerprint: run.transcriptFingerprint,
      proposal: run.editableProposal ?? run.originalOutput,
      modelMetadata: run.modelMetadata,
      createdAt: iso(run.createdAt),
      resolvedAt: run.resolvedAt ? iso(run.resolvedAt) : null
    } : null;
    return CallSnapshotSchema.parse({
      schemaVersion: CALL_NOTES_SCHEMA_VERSION,
      id: call.id,
      companyId: call.companyId.toString(),
      provider: call.provider,
      occurrenceKey: call.providerOccurrenceKey,
      title: call.title,
      status: call.status,
      capture: {
        id: capture.id,
        desiredMode: capture.desiredMode,
        lifecycle: capture.lifecycle,
        outcome: capture.outcome,
        activeAttemptId: capture.activeAttemptId,
        attemptCount: attempts.length
      },
      viewerCapabilities: {
        canEditNote: isNoteOwner,
        canControlCapture: isCaptureUser,
        canBookmark: isNoteOwner,
        canRequestEnrichment: isNoteOwner,
        canResolveEnrichment: isNoteOwner,
        canChangeVisibility: isNoteOwner,
        canChangeKnowledgeInclusion: isNoteOwner,
        canDelete
      },
      transcript,
      gaps: toGaps(gapRows),
      bookmarks: toBookmarks(bookmarkRows),
      note,
      enrichment,
      createdAt: iso(call.createdAt),
      updatedAt: iso(call.updatedAt ?? call.createdAt)
    });
  }
};
function createPostgresCallNotesApplication(options) {
  return new PostgresCallNotesApplication(options);
}

// src/zoom/capture-source.ts
import rtms from "@zoom/rtms";

// src/zoom/normalizer.ts
import { createHash as createHash2 } from "node:crypto";
function sha2562(value) {
  return createHash2("sha256").update(value).digest("hex");
}
function providerKey(value) {
  return String(value);
}
var ZoomCaptureEventNormalizer = class {
  constructor(context) {
    this.context = context;
  }
  receiveOrder = 0;
  connected(streamKey, occurredAt) {
    return this.event({
      kind: "attempt_connected",
      attemptKey: this.context.attemptKey,
      streamKey,
      occurredAt: occurredAt.toISOString()
    });
  }
  sessionState(input) {
    if (input.operation !== 3 && input.operation !== 4) return null;
    return this.event({
      kind: input.operation === 3 ? "attempt_paused" : "attempt_resumed",
      attemptKey: this.context.attemptKey,
      occurredAt: input.occurredAt.toISOString()
    });
  }
  interrupted(reason, occurredAt) {
    return this.event({
      kind: "transport_interrupted",
      attemptKey: this.context.attemptKey,
      occurredAt: occurredAt.toISOString(),
      ...reason ? { reason } : {}
    });
  }
  reconnected(occurredAt) {
    return this.event({
      kind: "transport_reconnected",
      attemptKey: this.context.attemptKey,
      occurredAt: occurredAt.toISOString()
    });
  }
  participant(kind, participant, occurredAt) {
    return this.event({
      kind,
      attemptKey: this.context.attemptKey,
      participant,
      occurredAt: occurredAt.toISOString()
    });
  }
  transcript(text2, providerTimestamp, metadata, receivedAt) {
    const normalizedText = text2.trim();
    if (!normalizedText) throw new Error("Zoom transcript text must not be empty");
    const packet = JSON.stringify({
      attemptKey: this.context.attemptKey,
      providerTimestamp,
      userId: providerKey(metadata.userId),
      userName: metadata.userName,
      startTs: metadata.startTs ?? null,
      endTs: metadata.endTs ?? null,
      language: metadata.language ?? null,
      text: normalizedText
    });
    const sourcePacketHash = sha2562(packet);
    const receiveOrder = this.receiveOrder++;
    return this.event({
      kind: "transcript_segment",
      attemptKey: this.context.attemptKey,
      providerEventKey: sourcePacketHash,
      sourcePacketHash,
      sourceKind: "provider_transcript",
      participant: {
        providerParticipantKey: providerKey(metadata.userId),
        displayName: metadata.userName
      },
      ...metadata.startTs === void 0 ? {} : { providerStartMs: metadata.startTs },
      ...metadata.endTs === void 0 ? {} : { providerEndMs: metadata.endTs },
      receivedAt: receivedAt.toISOString(),
      receiveOrder,
      text: normalizedText,
      ...metadata.language ? { language: metadata.language } : {},
      occurredAt: receivedAt.toISOString()
    });
  }
  ended(reasonCode, occurredAt) {
    const reason = reasonCode === 3 ? "capture_user_left" : reasonCode === 6 ? "meeting_ended" : "provider_stopped";
    return this.event({
      kind: "attempt_ended",
      attemptKey: this.context.attemptKey,
      reason,
      occurredAt: occurredAt.toISOString()
    });
  }
  occurrenceEnded(reason, occurredAt) {
    return this.event({
      kind: "occurrence_ended",
      occurredAt: occurredAt.toISOString(),
      ...reason ? { reason } : {}
    });
  }
  event(input) {
    const identity = JSON.stringify({
      occurrenceKey: this.context.occurrenceKey,
      attemptKey: "attemptKey" in input ? input.attemptKey : null,
      kind: input.kind,
      occurredAt: input.occurredAt,
      input
    });
    return CaptureEventSchema.parse({
      ...input,
      schemaVersion: CALL_NOTES_SCHEMA_VERSION,
      eventId: sha2562(identity),
      provider: "zoom",
      occurrenceKey: this.context.occurrenceKey
    });
  }
};

// src/zoom/capture-source.ts
var ZoomControlUnavailableError = class extends Error {
  constructor(action) {
    super(`Zoom ${action} control is unavailable in the auto-start demo`);
    this.name = "ZoomControlUnavailableError";
  }
};
var SerializedEventSink = class {
  constructor(sink) {
    this.sink = sink;
  }
  pending = Promise.resolve();
  failure;
  append(event) {
    this.pending = this.pending.then(() => this.sink.append(event)).catch((error) => {
      this.failure ??= error;
    });
  }
  async drain() {
    await this.pending;
    if (this.failure instanceof Error) throw this.failure;
    if (this.failure) {
      throw new Error("Capture event persistence failed", { cause: this.failure });
    }
  }
};
var ZoomAutoStartCaptureSource = class {
  constructor(startedStreams) {
    this.startedStreams = startedStreams;
  }
  capabilities = {
    attributedTranscript: true,
    nativePauseResume: false,
    transportReconnect: false,
    observesCaptureUserReturn: false
  };
  async startAttempt(input, sink) {
    const payload = await this.startedStreams.take(input.occurrenceKey);
    const normalizer = new ZoomCaptureEventNormalizer({
      occurrenceKey: input.occurrenceKey,
      attemptKey: input.attemptKey
    });
    const serialized = new SerializedEventSink(sink);
    const client = new rtms.Client();
    client.onJoinConfirm((reason) => {
      if (reason === 0) {
        serialized.append(normalizer.connected(payload.rtms_stream_id, /* @__PURE__ */ new Date()));
        return;
      }
      serialized.append({
        schemaVersion: "call-notes/v1",
        eventId: `zoom_join_failed_${input.attemptKey}_${reason}`,
        kind: "attempt_failed",
        provider: "zoom",
        occurrenceKey: input.occurrenceKey,
        attemptKey: input.attemptKey,
        occurredAt: (/* @__PURE__ */ new Date()).toISOString(),
        code: `zoom_join_${reason}`,
        message: "Zoom RTMS join was rejected"
      });
    });
    client.onSessionUpdate((operation) => {
      const event = normalizer.sessionState({ operation, occurredAt: /* @__PURE__ */ new Date() });
      if (event) serialized.append(event);
    });
    client.onUserUpdate((operation, participant) => {
      const kind = operation === rtms.USER_JOIN ? "participant_joined" : "participant_left";
      serialized.append(
        normalizer.participant(
          kind,
          {
            providerParticipantKey: String(participant.id),
            displayName: participant.name
          },
          /* @__PURE__ */ new Date()
        )
      );
    });
    client.onTranscriptData((buffer2, _size, timestamp2, metadata) => {
      serialized.append(
        normalizer.transcript(
          buffer2.toString("utf8"),
          timestamp2,
          {
            userId: metadata.userId,
            userName: metadata.userName,
            startTs: metadata.startTs,
            endTs: metadata.endTs
          },
          /* @__PURE__ */ new Date()
        )
      );
    });
    client.onMediaConnectionInterrupted((timestamp2) => {
      serialized.append(
        normalizer.interrupted(`media connection interrupted at ${timestamp2}`, /* @__PURE__ */ new Date())
      );
    });
    client.onLeave((reason) => {
      serialized.append(normalizer.ended(reason, /* @__PURE__ */ new Date()));
    });
    client.join(payload);
    return {
      async pause(_control) {
        throw new ZoomControlUnavailableError("pause");
      },
      async resume(_control) {
        throw new ZoomControlUnavailableError("resume");
      },
      async dispose() {
        client.leave();
        await serialized.drain();
      }
    };
  }
};

// src/zoom/started-stream-registry.ts
var ZoomStartedStreamRegistry = class {
  constructor(timeoutMs = 3e4) {
    this.timeoutMs = timeoutMs;
  }
  available = /* @__PURE__ */ new Map();
  waiters = /* @__PURE__ */ new Map();
  publish(payload) {
    const occurrenceKey = payload.meeting_uuid;
    const waiter = this.waiters.get(occurrenceKey);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.waiters.delete(occurrenceKey);
      waiter.resolve(payload);
      return;
    }
    this.available.set(occurrenceKey, payload);
  }
  take(occurrenceKey) {
    const payload = this.available.get(occurrenceKey);
    if (payload) {
      this.available.delete(occurrenceKey);
      return Promise.resolve(payload);
    }
    if (this.waiters.has(occurrenceKey)) {
      return Promise.reject(
        new Error(`A waiter already exists for Zoom occurrence ${occurrenceKey}`)
      );
    }
    const { promise, resolve, reject } = Promise.withResolvers();
    const timer2 = setTimeout(() => {
      this.waiters.delete(occurrenceKey);
      reject(new Error(`Timed out waiting for Zoom RTMS stream ${occurrenceKey}`));
    }, this.timeoutMs);
    this.waiters.set(occurrenceKey, { resolve, reject, timer: timer2 });
    return promise;
  }
  close() {
    for (const [occurrenceKey, waiter] of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(
        new Error(`Zoom stream registry closed while waiting for ${occurrenceKey}`)
      );
    }
    this.waiters.clear();
    this.available.clear();
  }
};

// src/worker.ts
var unavailableDocumentNotes = {
  async create() {
    throw new Error("Document Note writes are unavailable in call-worker");
  },
  async get() {
    throw new Error("Document Note reads are unavailable in call-worker");
  },
  async update() {
    throw new Error("Document Note writes are unavailable in call-worker");
  },
  async delete() {
    throw new Error("Document Note writes are unavailable in call-worker");
  }
};
var unavailableMemberships = {
  async getRole() {
    return null;
  }
};
var unavailableKnowledgeSink = {
  async upsert() {
    throw new Error("Knowledge writes are unavailable in call-worker");
  },
  async remove() {
    throw new Error("Knowledge writes are unavailable in call-worker");
  }
};
function parseProviderWork(value) {
  if (value.source !== "zoom_webhook" || typeof value.event !== "string") return null;
  if (!value.payload || typeof value.payload !== "object" || Array.isArray(value.payload)) {
    return null;
  }
  return {
    source: "zoom_webhook",
    event: value.event,
    payload: value.payload
  };
}
var CallWorkerRuntime = class {
  constructor(config) {
    this.config = config;
    this.database = createDb({ url: config.databaseUrl, maxConnections: 4 });
    this.workItems = new CallNotesWorkItems(this.database.db);
    this.application = createPostgresCallNotesApplication({
      db: this.database.db,
      memberships: unavailableMemberships,
      documentNotes: unavailableDocumentNotes,
      knowledgeSink: unavailableKnowledgeSink,
      detectedCalls: {
        async list() {
          return [];
        }
      }
    });
  }
  database;
  workItems;
  application;
  streams = new ZoomStartedStreamRegistry();
  source = new ZoomAutoStartCaptureSource(this.streams);
  activeHandles = /* @__PURE__ */ new Map();
  abort = new AbortController();
  async run() {
    while (!this.abort.signal.aborted) {
      const work = await this.workItems.claimNext(this.config.workerId, {
        kind: "provider_event",
        leaseMs: 3e4
      });
      if (!work) {
        await delay(this.config.pollIntervalMs, void 0, {
          signal: this.abort.signal
        }).catch(() => void 0);
        continue;
      }
      try {
        const handled = await this.process(work.companyId.toString(), work.payload);
        if (!handled) {
          await this.workItems.release(
            work.id,
            work.leaseToken,
            new Date(Date.now() + this.config.pollIntervalMs)
          );
        } else {
          await this.workItems.complete(work.id, work.leaseToken);
        }
      } catch (error) {
        await this.workItems.fail(work.id, work.leaseToken, {
          code: "zoom_provider_event_failed",
          message: error instanceof Error ? error.message.slice(0, 1024) : "Unknown Zoom failure"
        });
      }
    }
  }
  async close() {
    this.abort.abort();
    this.streams.close();
    await Promise.allSettled([...this.activeHandles.values()].map((handle) => handle.dispose()));
    this.activeHandles.clear();
    await this.database.close();
  }
  async process(companyId, rawPayload) {
    const work = parseProviderWork(rawPayload);
    if (!work) return true;
    if (work.event === "meeting.rtms_started") {
      const payload = this.startedPayload(work.payload);
      const target = await this.captureTarget(companyId, payload.meeting_uuid);
      if (!target) return false;
      if (this.activeHandles.size >= this.config.maxConcurrentStreams) {
        throw new Error("Configured RTMS concurrency boundary is exhausted");
      }
      this.streams.publish(payload);
      const input = {
        schemaVersion: "call-notes/v1",
        provider: "zoom",
        occurrenceKey: target.occurrenceKey,
        attemptKey: payload.rtms_stream_id,
        authorizationRef: target.captureUserConnectionId,
        captureUser: {
          providerParticipantKey: target.captureUserProviderKey,
          displayName: "Zoom Capture User"
        }
      };
      const handle = await this.source.startAttempt(input, {
        append: (event) => this.application.ingestCaptureEvent(target.companyId, event)
      });
      this.activeHandles.set(payload.rtms_stream_id, handle);
      return true;
    }
    if (work.event === "meeting.rtms_stopped") {
      const streamId = typeof work.payload.rtms_stream_id === "string" ? work.payload.rtms_stream_id : null;
      if (!streamId) return true;
      const handle = this.activeHandles.get(streamId);
      if (!handle) return true;
      await handle.dispose();
      this.activeHandles.delete(streamId);
    }
    return true;
  }
  startedPayload(payload) {
    if (typeof payload.meeting_uuid !== "string" || typeof payload.rtms_stream_id !== "string" || typeof payload.server_urls !== "string") {
      throw new Error("Invalid meeting.rtms_started payload");
    }
    return payload;
  }
  async captureTarget(companyId, occurrenceKey) {
    const [target] = await this.database.db.select({
      companyId: callNotesCalls.companyId,
      occurrenceKey: callNotesCalls.providerOccurrenceKey,
      captureUserConnectionId: callNotesCaptures.captureUserConnectionId,
      captureUserProviderKey: callNotesCaptures.captureUserProviderKey
    }).from(callNotesCalls).innerJoin(callNotesCaptures, eq(callNotesCaptures.callId, callNotesCalls.id)).where(
      and(
        eq(callNotesCalls.companyId, BigInt(companyId)),
        eq(callNotesCalls.provider, "zoom"),
        eq(callNotesCalls.providerOccurrenceKey, occurrenceKey)
      )
    ).limit(1);
    if (!target) return null;
    return {
      companyId: target.companyId.toString(),
      occurrenceKey: target.occurrenceKey,
      captureUserConnectionId: target.captureUserConnectionId,
      captureUserProviderKey: target.captureUserProviderKey
    };
  }
};

// src/main.ts
function log(event, fields = {}) {
  process.stdout.write(
    `${JSON.stringify({ event, ...fields, observedAt: (/* @__PURE__ */ new Date()).toISOString() })}
`
  );
}
async function main() {
  const config = loadCallWorkerConfig();
  const streams = new ZoomStartedStreamRegistry();
  const source = new ZoomAutoStartCaptureSource(streams);
  const { promise: stopped, resolve: stop } = Promise.withResolvers();
  let runtime;
  let closing;
  const shutdown = (signal) => {
    if (closing) return;
    log("call_worker_stopping", { signal });
    streams.close();
    closing = (runtime ? runtime.close() : Promise.resolve()).finally(stop);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  if (config.captureEnabled && config.maxConcurrentStreams < 1) {
    throw new Error(
      "CALL_NOTES_CAPTURE_ENABLED requires a positive ZOOM_RTMS_MAX_CONCURRENT_STREAMS"
    );
  }
  log("call_worker_ready", {
    workerId: config.workerId,
    captureEnabled: config.captureEnabled,
    maxConcurrentStreams: config.maxConcurrentStreams,
    attributedTranscript: source.capabilities.attributedTranscript,
    nativePauseResume: source.capabilities.nativePauseResume
  });
  const keepAlive = setInterval(() => {
    log("call_worker_heartbeat", { workerId: config.workerId });
  }, 3e4);
  try {
    if (config.captureEnabled) {
      runtime = new CallWorkerRuntime(config);
      await Promise.race([stopped, runtime.run()]);
    } else {
      await stopped;
    }
  } finally {
    clearInterval(keepAlive);
    streams.close();
    if (closing) await closing;
    else if (runtime) await runtime.close();
  }
  log("call_worker_stopped", { workerId: config.workerId });
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown call worker failure";
  log("call_worker_failed", { message });
  process.exitCode = 1;
});
