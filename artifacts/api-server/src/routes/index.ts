import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analyzeRouter from "./analyze";
import marketRouter from "./market";
import marketsRouter from "./markets";
import extraRouter from "./extra";
import aiRouter from "./ai";
import planRouter from "./plan";
import authRouter from "./auth";
import alertsRouter from "./alerts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(analyzeRouter);
router.use(marketRouter);
router.use(marketsRouter);
router.use(extraRouter);
router.use(aiRouter);
router.use(planRouter);
router.use(alertsRouter);

export default router;
