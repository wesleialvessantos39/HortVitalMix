import express from 'express';
import { foundationRouter } from './routes/foundationRoutes';
import { requestContext } from './middleware/requestContext';
import { sameOrigin } from './middleware/sameOrigin';
import { sessionMiddleware } from './middleware/session';
export function createApp(){
 const app=express();
 app.disable('x-powered-by');
 app.use(express.json({limit:'100kb'}));
 app.use(requestContext);
 app.use(sameOrigin);
 app.use(sessionMiddleware);
 app.use('/api',foundationRouter);
 app.use('/api',(req,res)=>res.status(404).json({error:'NOT_FOUND',requestId:req.requestId}));
 return app;
}
