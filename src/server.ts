process.env.TZ = process.env.TZ || 'America/Mexico_City';
import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import { api } from './routes';
import { load } from './db';
import { HttpError } from './util';

load(); // crea data/db.json la primera vez
const app = express();
app.use(express.json());
app.use('/api', api);
app.use('/api', (_q, _r, next) => next(new HttpError(404, 'Ruta no encontrada')));
app.use(express.static(path.join(process.cwd(), 'public')));

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : err.message });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`SIGEF en http://localhost:${PORT}`));
