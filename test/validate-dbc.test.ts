import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {expect,it} from "vitest";
import {validateDbcFiles} from "@/server/pipeline/validate-dbc";
it.skipIf(!process.env.CAN_PYTHON_BIN)("rejects syntactically invalid DBCs using the actual plotting parser",async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),"validate-dbc-"));
 try{const file=path.join(directory,"valid.dbc"),invalid=path.join(directory,"invalid.dbc");
 await fs.writeFile(file,'VERSION ""\nNS_ :\nBS_:\nBU_: ECU\nBO_ 256 Status: 8 ECU\n SG_ State : 0|8@1+ (1,0) [0|255] "" ECU\n');
 await fs.writeFile(invalid,'BO_ 256 invalid\n SG_ malformed');
 await expect(validateDbcFiles([file])).resolves.toBeUndefined();await expect(validateDbcFiles([file,invalid])).rejects.toThrow("DBC解析失败");
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
