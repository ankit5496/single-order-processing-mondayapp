import express from 'express';
import dotenv from 'dotenv';
import bodyParser from 'body-parser';
import path from 'path';
import router from './routes/index';

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '..', 'client', 'build')));

app.use(router);

app.listen(port, () => console.log(`Server running on port ${port}`));

export default app;
