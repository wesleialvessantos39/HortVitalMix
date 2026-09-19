export type CleanupTask=()=>Promise<void>;

export class CleanupTracker{
  private readonly tasks:CleanupTask[]=[];

  add(task:CleanupTask):void{this.tasks.push(task);}

  async run():Promise<void>{
    const failures:unknown[]=[];
    while(this.tasks.length){
      const task=this.tasks.pop();
      if(!task)continue;
      try{await task();}catch(error){failures.push(error);}
    }
    if(failures.length)throw new AggregateError(failures,'Falha ao limpar fixtures de integração.');
  }
}
