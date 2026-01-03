from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import subprocess, os, uuid

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class CodeRequest(BaseModel):
    code: str
    language: str

@app.post("/api/execute")
async def execute_code(request: CodeRequest):
    try:
        temp_id = str(uuid.uuid4())[:8]
        os.makedirs("exec_tmp", exist_ok=True)
        
        # ✅ FIXED PYTHON - Use FULL PATH, NO cwd
        if request.language == "python":
            filepath = f"exec_tmp/{temp_id}.py"
            with open(filepath, 'w') as f: f.write(request.code)
            full_path = os.path.abspath(filepath)
            result = subprocess.run(['python3', full_path], capture_output=True, text=True, timeout=10)
            output = result.stdout + result.stderr
        
        elif request.language == "javascript":
            filepath = f"exec_tmp/{temp_id}.js"
            with open(filepath, 'w') as f: f.write(request.code)
            full_path = os.path.abspath(filepath)
            result = subprocess.run(['node', full_path], capture_output=True, text=True, timeout=10)
            output = result.stdout + result.stderr
        
        elif request.language == "java":
            filepath = f"exec_tmp/{temp_id}.java"
            with open(filepath, 'w') as f: f.write(request.code)
            full_path = os.path.abspath(filepath)
            compile_result = subprocess.run(['javac', full_path], capture_output=True, text=True, timeout=10, cwd="exec_tmp")
            if compile_result.returncode == 0:
                class_name = os.path.splitext(os.path.basename(filepath))[0]
                result = subprocess.run(['java', class_name], capture_output=True, text=True, timeout=10, cwd="exec_tmp")
                output = result.stdout + result.stderr
            else:
                output = f"Compile Error:\n{compile_result.stderr}"
        
        elif request.language == "cpp":
            filepath = f"exec_tmp/{temp_id}.cpp"
            with open(filepath, 'w') as f: f.write(request.code)
            full_path = os.path.abspath(filepath)
            out_path = os.path.abspath(f"exec_tmp/{temp_id}_out")
            compile_result = subprocess.run([
                'clang++', '-std=c++11', '-o', out_path, full_path
            ], capture_output=True, text=True, timeout=10, cwd="exec_tmp")
            if compile_result.returncode == 0:
                result = subprocess.run([out_path], capture_output=True, text=True, timeout=10, cwd="exec_tmp")
                output = result.stdout + result.stderr
            else:
                output = f"Compile Error:\n{compile_result.stderr}"
        
        elif request.language == "c":
            filepath = f"exec_tmp/{temp_id}.c"
            with open(filepath, 'w') as f: f.write(request.code)
            full_path = os.path.abspath(filepath)
            out_path = os.path.abspath(f"exec_tmp/{temp_id}_out")
            compile_result = subprocess.run(['clang', '-o', out_path, full_path], 
                                          capture_output=True, text=True, timeout=10, cwd="exec_tmp")
            if compile_result.returncode == 0:
                result = subprocess.run([out_path], capture_output=True, text=True, timeout=10, cwd="exec_tmp")
                output = result.stdout + result.stderr
            else:
                output = f"Compile Error:\n{compile_result.stderr}"
        else:
            output = "Language not supported"
        
        # Cleanup
        for ext in ['.py', '.js', '.java', '.cpp', '.c', '_out', '.class']:
            try: os.remove(f"exec_tmp/{temp_id}{ext}")
            except: pass
                
        return {"output": output}
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
