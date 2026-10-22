/**
 * PostgreSQL's `::jsonb` refuses JSON text that Node's `JSON.parse` accepts.
 *
 * `kv_store.value` is TEXT and every writer goes through Node, whose
 * `JSON.stringify` writes a lone UTF-16 surrogate as the escape `\ud83d` and a
 * NUL as `\u0000`. Node reads both back; jsonb refuses both — SQLSTATE `22P02`
 * ("Unicode low surrogate must follow a high surrogate") and `22P05`
 * ("\u0000 cannot be converted to text"). A projection that casts every team
 * row in one statement therefore fails whole on one such row. `value::json`
 * with `->>` refuses the lone surrogate too, and `pg_input_is_valid` does not
 * exist on postgres:15, so the way round is to read the rows and parse them in
 * Node.
 */

const JSONB_REFUSAL_CODES = new Set(['22P02', '22P05']);

/** Whether a query error is jsonb refusing text that may still parse in Node. */
export const isJsonbRefusal = (err) => JSONB_REFUSAL_CODES.has(err?.code);

/**
 * Every row whose key starts with `prefix`, read one at a time and parsed in
 * Node, each mapped through `pick(value)`: the fallback of a projection jsonb
 * refused. One parsed record is held at a time, so memory stays bounded by
 * the largest row. A row deleted between the key scan and its read is
 * skipped. A row Node cannot parse either throws, naming the key and never
 * the content (`code: 'ROW_UNPARSABLE'`): that one is corrupt, and the caller
 * reports it as the projection would have.
 *
 * @template T
 * @param {{
 *   query: (sql: string, params: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>,
 *   prefix: string,
 *   pick: (value: unknown) => T
 * }} options
 * @returns {Promise<T[]>}
 */
export const readRowsOneByOne = async ({ query, prefix, pick }) => {
  const { rows: keys } = await query('SELECT key FROM kv_store WHERE key LIKE $1 ORDER BY key', [`${prefix}%`]);
  const picked = [];
  for (const { key } of keys) {
    const { rows } = await query('SELECT value FROM kv_store WHERE key = $1', [key]);
    const text = rows[0]?.value;
    if (text == null) continue;
    let value;
    try {
      value = JSON.parse(String(text));
    } catch {
      throw Object.assign(new Error(`Record ${JSON.stringify(key)} cannot be parsed`), { code: 'ROW_UNPARSABLE', key });
    }
    picked.push(pick(value));
  }
  return picked;
};
