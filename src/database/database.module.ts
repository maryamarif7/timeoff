import { Module, Global, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
const Database = require('better-sqlite3');
import * as path from 'path';
import * as fs from 'fs';

export const DB_TOKEN = 'SQLITE_DB';

@Global()
@Module({
  providers: [
    {
      provide: DB_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dbPath = config.get<string>('database.path') ?? ':memory:';
        if (dbPath !== ':memory:') {
          const dir = path.dirname(dbPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        }
        const db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        return db;
      },
    },
     
  ],
  exports: [DB_TOKEN],
})
export class DatabaseModule implements OnModuleInit {
  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
   
  }
}