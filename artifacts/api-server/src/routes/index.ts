import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analyzeRouter from "./analyze";
import marketRouter from "./market";

const router: IRouter = Router();

router.use(healthRouter);
router.use(analyzeRouter);
router.use(marketRouter);

export default router;
