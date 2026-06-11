import {Router} from 'express';
const router = Router();

import * as transformationController from '../controllers/monday-controller';
import { mondayTokenMiddleware } from '../middlewares/authentication';

router.post('/api/monday/execute_action', mondayTokenMiddleware, transformationController.executeAction);
router.post('/api/monday/reverse_string', mondayTokenMiddleware, transformationController.reverseString);

export default router;
