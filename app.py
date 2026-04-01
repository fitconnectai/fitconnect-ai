import os
import json
from flask import Flask, request, jsonify, session
from google.genai import types

try:
    from google import genai
except ImportError:
    print("The 'google-genai' package is not installed.")
    exit(1)

api_key = os.environ.get("GEMINI_API_KEY")
if not api_key:
    print("WARNING: GEMINI_API_KEY environment variable not set. Please set it before running the server.")
    # We do not hardcode the key here for security reasons.

app = Flask(__name__, static_folder='static')
app.secret_key = "super_secret_fitness_key_for_sessions"
client = genai.Client(api_key=api_key)

chat_sessions = {}

@app.route('/')
def serve_index():
    return app.send_static_file('index.html')

# fetch_exercise_gif is now obsolete as we use static dictionary lookup

@app.route('/api/generate_plan', methods=['POST'])
def generate_plan():
    data = request.json
    metrics = data.get('metrics', {})
    uid = data.get('uid', 'anonymous')
    
    plan_type = data.get('plan_type', 'single')  # 'single' or 'all'

    # Load the Manual Exercise Dictionary on every request so it acts like a live DB
    exercises_data = {}
    try:
        with open('exercises.json', 'r') as f:
            exercises_data = json.load(f)
    except Exception as e:
        print(f"Warning: Could not load exercises.json: {e}")

    # Flatten the categories for easier AI consumption and lookup
    all_exercises = {}
    for category, exercises in exercises_data.items():
        for name, url in exercises.items():
            all_exercises[name] = url
            all_exercises[name.lower()] = url # Add lower case up front

    import re
    days_str = str(metrics.get('days', '1'))
    matches = re.findall(r'\d+', days_str)
    exact_days = int(matches[-1]) if matches else 1

    if plan_type == 'all':
        output_format = """\
{
  "intro": "A brief encouraging introductory message (1-2 sentences).",
  "nutrition": "A customized Nutrition Plan (Macros, simple calories strategy, brief meal ideas).",
  "days": [
    {
      "day": "Day 1",
      "focus": "Push – Upper Body",
      "exercises": [
        {
          "name": "Barbell Bench Press",
          "description": "Lie on a flat bench, grip bar slightly wider than shoulders, lower to chest then press up.",
          "sets": 4,
          "reps": "8-10"
        }
      ]
    }
  ]
}"""
        scope_instruction = f"Generate a COMPLETE {exact_days}-day workout plan covering EVERY SINGLE training day. It is CRITICAL that you output EXACTLY {exact_days} days in the 'days' array based on their commitment. DO NOT stop early. DO NOT output fewer than {exact_days} days."
    else:
        output_format = """\
{
  "intro": "A brief encouraging introductory message (1-2 sentences).",
  "nutrition": "A customized Nutrition Plan (Macros, simple calories strategy, brief meal ideas).",
  "day": "Day 1",
  "focus": "Push – Upper Body",
  "exercises": [
    {
      "name": "Barbell Bench Press",
      "description": "Lie on a flat bench, grip bar slightly wider than shoulders, lower to chest then press up.",
      "sets": 4,
      "reps": "8-10"
    }
  ]
}"""
        scope_instruction = "Generate a plan for Day 1 only."

    # Filter exercises for the prompt to keep it concise but strictly relevant
    valid_exercises = [name for name, url in all_exercises.items() if url and (name[0].isupper() or name[0].isdigit())]
    exercise_pool = ", ".join(valid_exercises)

    prompt = f"""
You are an AI fitness assistant integrated into a workout planning website.
Your task is to generate a structured workout plan based on the user's profile.

User Profile:
- Age, Gender, Height, Weight: {metrics.get('basic')}
- Primary Goal: {metrics.get('goal')}
- Dietary Preferences/Restrictions: {metrics.get('diet')}
- Lifestyle Activity Level: {metrics.get('activity')}
- Lifter Experience Level: {metrics.get('experience')}
- Gym Commitment (Days/Week): {metrics.get('days')}
- Session Duration: {metrics.get('duration')}
- Equipment Access: {metrics.get('equipment')}
- Health Conditions/Injuries: {metrics.get('health')}

-----------------------------------
ALLOWED EXERCISES (STRICT RULE)
-----------------------------------
You MUST pick exercises ONLY from this specific list: 
{exercise_pool}

DO NOT suggest any exercise that is not in the list above.

-----------------------------------
SCOPE
-----------------------------------
{scope_instruction}

-----------------------------------
CORE OBJECTIVE
-----------------------------------
For every exercise you suggest, you MUST include:
1. An EXACT name from the allowed list above.
2. A short description of how to perform it (1-2 sentences)
3. Sets and Reps appropriate for the goal.

-----------------------------------
NUTRITION FORMATTING RULES (CRITICAL)
-----------------------------------
The `nutrition` field MUST be plain text.
DO NOT use asterisks (*) for bullet points, bolding, or markdown. Use dashes (-) for lists or plain text spacing.

-----------------------------------
OUTPUT FORMAT (STRICT JSON)
-----------------------------------
Return ONLY valid JSON — no markdown, no extra text:

{output_format}

-----------------------------------
CONSTRAINTS
-----------------------------------
- Keep descriptions concise (1-2 sentences)
- No asterisks in the nutrition field
- Output ONLY valid JSON
"""
    try:
        chat = client.chats.create(model='gemini-2.5-flash')
        response = chat.send_message(prompt)
        chat_sessions[uid] = chat
        
        # Parse the JSON to inject the GIF URLs from our dictionary
        try:
            raw = response.text
            start_idx = raw.find('{')
            end_idx = raw.rfind('}')
            if start_idx == -1 or end_idx == -1:
                raise ValueError("No JSON found in response")
            plan_data = json.loads(raw[start_idx:end_idx+1])
            
            # Helper to process exercises array
            def inject_gifs(exercises):
                for ex in exercises:
                    name = ex.get('name', '')
                    print(f"[DEBUG] Looking up: {repr(name)}, found={name in all_exercises}, url={bool(all_exercises.get(name))}")
                    if name in all_exercises and all_exercises[name]:
                        ex['gif_url'] = all_exercises[name]
                    elif name.lower() in all_exercises and all_exercises[name.lower()]:
                        ex['gif_url'] = all_exercises[name.lower()]
                            
            if 'days' in plan_data:
                for day in plan_data['days']:
                    inject_gifs(day.get('exercises', []))
            elif 'exercises' in plan_data:
                inject_gifs(plan_data.get('exercises', []))
                
            final_json = json.dumps(plan_data)
        except Exception as parse_err:
            print(f"JSON Parse/Dictionary error: {parse_err}")
            final_json = response.text  # fallback
            
        return jsonify({"plan": final_json})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.json
    message = data.get('message', '')
    uid = data.get('uid', 'anonymous')
    plan_text = data.get('plan_text', '')
    
    try:
        with open('exercises.json', 'r') as f:
            exercise_dict = json.load(f)
            
        ALL_EXERCISES = {}
        for category, cat_dict in exercise_dict.items():
            for ex_name, link in cat_dict.items():
                ALL_EXERCISES[ex_name] = link
                ALL_EXERCISES[ex_name.lower()] = link
                
        allowed_list = list(ALL_EXERCISES.keys())
        # only take original capitalized keys for prompt that have a valid url
        allowed_exercises = [k for k in allowed_list if (k[0].isupper() or k[0].isdigit()) and ALL_EXERCISES[k]]
        
        chat_session = chat_sessions.get(uid)
        if not chat_session:
            if not plan_text:
                return jsonify({"error": "Please generate a plan first before chatting."}), 400
            
            sys_inst = f"""You are FitConnect AI. The user's previous plan context: {plan_text[:1000]}...
If they ask for a general tip, reply in plain text.
If they ask to generate a workout plan (e.g. 'Day 2'), YOU MUST output strictly valid JSON, with exercises chosen ONLY from this list: {', '.join(allowed_exercises)}.
JSON scheme for plan:
{{
  "days": [ {{ "day": "Day 2", "focus": "...", "exercises": [ {{ "name": "Exact Name", "sets": 3, "reps": "10", "description": "..." }} ] }} ]
}}"""
            chat_session = client.chats.create(
                model='gemini-2.5-flash',
                config=types.GenerateContentConfig(system_instruction=sys_inst)
            )
            chat_sessions[uid] = chat_session
            
        response = chat_session.send_message(message)
        text = response.text
        
        # Inject URLs if response contains JSON
        try:
            start_idx = text.find('{')
            end_idx = text.rfind('}')
            if start_idx != -1 and end_idx != -1 and end_idx > start_idx:
                json_candidate = text[start_idx:end_idx+1]
                plan_data = json.loads(json_candidate)
                
                if 'exercises' in plan_data or 'days' in plan_data:
                    if 'days' in plan_data:
                        for day in plan_data.get('days', []):
                            for ex in day.get('exercises', []):
                                n = ex.get('name', '')
                                if n in ALL_EXERCISES: ex['gif_url'] = ALL_EXERCISES[n]
                                elif n.lower() in ALL_EXERCISES: ex['gif_url'] = ALL_EXERCISES[n.lower()]
                    elif 'exercises' in plan_data:
                        for ex in plan_data.get('exercises', []):
                                n = ex.get('name', '')
                                if n in ALL_EXERCISES: ex['gif_url'] = ALL_EXERCISES[n]
                                elif n.lower() in ALL_EXERCISES: ex['gif_url'] = ALL_EXERCISES[n.lower()]
                                
                    updated_json = json.dumps(plan_data, indent=2)
                    text = text[:start_idx] + updated_json + text[end_idx+1:]
        except Exception as e:
            print(f"Chat json injection error: {e}")
            pass

        return jsonify({"response": text})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
