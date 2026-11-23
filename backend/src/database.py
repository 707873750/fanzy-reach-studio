"""Small async database boundary shared by SQLite and the Workers D1 binding."""


class D1Database:
    def __init__(self, binding):
        self.binding = binding

    def statement(self, sql, values):
        return self.binding.prepare(sql).bind(*values)

    async def first(self, sql, *values):
        return await self.statement(sql, values).first()

    async def all(self, sql, *values):
        result = await self.statement(sql, values).all()
        return result["results"]

    async def run(self, sql, *values):
        await self.statement(sql, values).run()

    async def batch(self, statements):
        # workers-runtime-sdk converts lists and wrapped D1 statements itself.
        # Applying raw to_js here creates borrowed proxies with invalid lifetimes.
        await self.binding.batch([self.statement(sql, values) for sql, values in statements])


class SQLiteDatabase:
    def __init__(self, path, schema):
        # Never imported by the Worker entrypoint. Local disk storage only.
        import sqlite3

        self.connection = sqlite3.connect(path, isolation_level=None)
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript(schema)

    async def first(self, sql, *values):
        row = self.connection.execute(sql, values).fetchone()
        return dict(row) if row is not None else None

    async def all(self, sql, *values):
        return [dict(row) for row in self.connection.execute(sql, values).fetchall()]

    async def run(self, sql, *values):
        self.connection.execute(sql, values)

    async def batch(self, statements):
        # No await inside the transaction; another coroutine cannot interleave.
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            for sql, values in statements:
                self.connection.execute(sql, values)
            self.connection.execute("COMMIT")
        except BaseException:
            self.connection.execute("ROLLBACK")
            raise

    def close(self):
        self.connection.close()
