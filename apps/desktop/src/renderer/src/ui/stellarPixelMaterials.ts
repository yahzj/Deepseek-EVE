// 自动生成：tools/pixel-planets-materials.cjs；手改会被覆盖。
// PixelPlanets (c) 2020 Deep-Fold，MIT；源提交a712f460077119aeb5f3b688c0785021df8cabb3。
// 原层算法/参数来自指纹一致的Godot3.5程序；语法适配与光照入口替换，非逐像素相同光照。
// 原作者注明：Cells源自Dave_Hoskins https://www.shadertoy.com/view/4djGRh；circleNoise源自Leukbaars https://www.shadertoy.com/view/4tK3zR。
export const STELLAR_PIXEL_MATERIALS = {
  "shaders": [
    "uniform float pixels;\nuniform float rotation;\nuniform vec2 light_origin;\nuniform float time_speed;\nuniform float dither_size;\nuniform float light_border_1;\nuniform float light_border_2;\nuniform vec4 color1;\nuniform vec4 color2;\nuniform vec4 color3;\nuniform float size;\nuniform int OCTAVES;\nuniform float seed;\nuniform float time;\nuniform bool should_dither;\n\nfloat rand(vec2 coord) {\n\tcoord = mod(coord, vec2(1.0,1.0)*floor(size+0.5));\n\treturn fract(sin(dot(coord.xy ,vec2(12.9898,78.233))) * 15.5453 * seed);\n}\n\nfloat noise(vec2 coord){\n\tvec2 i = floor(coord);\n\tvec2 f = fract(coord);\n\t\n\tfloat a = rand(i);\n\tfloat b = rand(i + vec2(1.0, 0.0));\n\tfloat c = rand(i + vec2(0.0, 1.0));\n\tfloat d = rand(i + vec2(1.0, 1.0));\n\n\tvec2 cubic = f * f * (3.0 - 2.0 * f);\n\n\treturn mix(a, b, cubic.x) + (c - a) * cubic.y * (1.0 - cubic.x) + (d - b) * cubic.x * cubic.y;\n}\n\nfloat fbm(vec2 coord){\n\tfloat value = 0.0;\n\tfloat scale = 0.5;\n\n\tfor(int i=0;i<20;i++){if(i>=OCTAVES)break;\n\t\tvalue += noise(coord) * scale;\n\t\tcoord *= 2.0;\n\t\tscale *= 0.5;\n\t}\n\treturn value;\n}\n\nbool dither(vec2 uv1, vec2 uv2) {\n\treturn mod(uv1.x+uv2.y,2.0/pixels) <= 1.0 / pixels;\n}\n\nvec2 rotate(vec2 coord, float angle){\n\tcoord -= 0.5;\n\tcoord *= mat2(vec2(cos(angle),-sin(angle)),vec2(sin(angle),cos(angle)));\n\treturn coord + 0.5;\n}\n\nvoid materialMain() {\n\t\n\tvec2 uv = floor(materialUv*pixels)/pixels;\n\t\n\t\n\tfloat d_circle = distance(uv, vec2(0.5));\n\tfloat d_light = illuminationDistance();\n\t\n\t\n\tfloat a = step(d_circle, 0.49999);\n\t\n\tbool dith = dither(uv ,materialUv);\n\tuv = rotate(uv, rotation);\n\n\t\n\t\n\tfloat fbm1 = fbm(uv);\n\td_light += fbm(uv*size+fbm1+vec2(time*time_speed, 0.0))*0.3; \n\t\n\t\n\tfloat dither_border = (1.0/pixels)*dither_size;\n\n\t\n\tvec4 col = color1;\n\tif (d_light > light_border_1) {\n\t\tcol = color2;\n\t\tif (d_light < light_border_1 + dither_border && (dith || !should_dither)) {\n\t\t\tcol = color1;\n\t\t}\n\t}\n\tif (d_light > light_border_2) {\n\t\tcol = color3;\n\t\tif (d_light < light_border_2 + dither_border && (dith || !should_dither)) {\n\t\t\tcol = color2;\n\t\t}\n\t}\n\t\n\tmaterialColor = vec4(col.rgb, a * col.a);\n}",
    "uniform float pixels;\nuniform float rotation;\nuniform vec2 light_origin;\nuniform float time_speed;\nuniform float light_border;\nuniform vec4 color1;\nuniform vec4 color2;\nuniform float size;\nuniform float seed;\nuniform float time;\n\nfloat rand(vec2 coord) {\n\tcoord = mod(coord, vec2(1.0,1.0)*floor(size+0.5));\n\treturn fract(sin(dot(coord.xy ,vec2(12.9898,78.233))) * 15.5453 * seed);\n}\n\n\nfloat circleNoise(vec2 uv) {\n    float uv_y = floor(uv.y);\n    uv.x += uv_y*.31;\n    vec2 f = fract(uv);\n\tfloat h = rand(vec2(floor(uv.x),floor(uv_y)));\n    float m = (length(f-0.25-(h*0.5)));\n    float r = h*0.25;\n    return m = smoothstep(r-.10*r,r,m);\n}\n\nfloat crater(vec2 uv) {\n\tfloat c = 1.0;\n\tfor (int i = 0; i < 2; i++) {\n\t\tc *= circleNoise((uv * size) + (float(i+1)+10.) + vec2(time*time_speed,0.0));\n\t}\n\treturn 1.0 - c;\n}\n\nvec2 spherify(vec2 uv) {\n\tvec2 centered= uv *2.0-1.0;\n\tfloat z = sqrt(max(0.0,1.0-dot(centered.xy,centered.xy)));\n\tvec2 sphere = centered/(z + 1.0);\n\treturn sphere * 0.5+0.5;\n}\n\nvec2 rotate(vec2 coord, float angle){\n\tcoord -= 0.5;\n\tcoord *= mat2(vec2(cos(angle),-sin(angle)),vec2(sin(angle),cos(angle)));\n\treturn coord + 0.5;\n}\n\nvoid materialMain() {\n\t\n\tvec2 uv = floor(materialUv*pixels)/pixels;\n\t\n\t\n\tfloat d_circle = distance(uv, vec2(0.5));\n\tfloat d_light = illuminationDistance();\n\t\n\t\n\tfloat a = step(d_circle, 0.49999);\n\t\n\tuv = rotate(uv, rotation);\n\tuv = spherify(uv);\n\t\t\n\tfloat c1 = crater(uv );\n\tfloat c2 = crater(uv +(light_origin-0.5)*0.03);\n\tvec4 col = color1;\n\t\n\ta *= step(0.5, c1);\n\tif (c2<c1-(0.5-d_light)*2.0) {\n\t\tcol = color2;\n\t}\n\tif (d_light > light_border) {\n\t\tcol = color2;\n\t} \n\n\t\n\ta*= step(d_circle, 0.5);\n\tmaterialColor = vec4(col.rgb, a * col.a);\n}",
    "uniform float pixels;\nuniform float rotation;\nuniform vec2 light_origin;\nuniform float time_speed;\nuniform float dither_size;\nuniform float light_border_1;\nuniform float light_border_2;\nuniform vec4 color1;\nuniform vec4 color2;\nuniform vec4 color3;\nuniform float size;\nuniform int OCTAVES;\nuniform float seed;\nuniform float time;\nuniform bool should_dither;\n\nfloat rand(vec2 coord) {\n\t\n\t\n\t\n\t\n\tcoord = mod(coord, vec2(2.0,1.0)*floor(size+0.5));\n\treturn fract(sin(dot(coord.xy ,vec2(12.9898,78.233))) * 15.5453 * seed);\n}\n\nfloat noise(vec2 coord){\n\tvec2 i = floor(coord);\n\tvec2 f = fract(coord);\n\t\n\tfloat a = rand(i);\n\tfloat b = rand(i + vec2(1.0, 0.0));\n\tfloat c = rand(i + vec2(0.0, 1.0));\n\tfloat d = rand(i + vec2(1.0, 1.0));\n\n\tvec2 cubic = f * f * (3.0 - 2.0 * f);\n\n\treturn mix(a, b, cubic.x) + (c - a) * cubic.y * (1.0 - cubic.x) + (d - b) * cubic.x * cubic.y;\n}\n\nfloat fbm(vec2 coord){\n\tfloat value = 0.0;\n\tfloat scale = 0.5;\n\n\tfor(int i=0;i<20;i++){if(i>=OCTAVES)break;\n\t\tvalue += noise(coord) * scale;\n\t\tcoord *= 2.0;\n\t\tscale *= 0.5;\n\t}\n\treturn value;\n}\n\nbool dither(vec2 uv1, vec2 uv2) {\n\treturn mod(uv1.x+uv2.y,2.0/pixels) <= 1.0 / pixels;\n}\n\nvec2 rotate(vec2 coord, float angle){\n\tcoord -= 0.5;\n\tcoord *= mat2(vec2(cos(angle),-sin(angle)),vec2(sin(angle),cos(angle)));\n\treturn coord + 0.5;\n}\n\nvec2 spherify(vec2 uv) {\n\tvec2 centered= uv *2.0-1.0;\n\tfloat z = sqrt(max(0.0,1.0-dot(centered.xy,centered.xy)));\n\tvec2 sphere = centered/(z + 1.0);\n\treturn sphere * 0.5+0.5;\n}\n\n\nvoid materialMain() {\n\t\n\tvec2 uv = floor(materialUv*pixels)/pixels;\n\t\n\tbool dith = dither(uv, materialUv);\n\t\n\t\n\tfloat d_light = illuminationDistance();\n\t\n\t\n\tfloat d_circle = distance(uv, vec2(0.5));\n\t\n\tfloat a = step(d_circle, 0.49999);\n\t\n\tuv = spherify(uv);\n\tuv = rotate(uv, rotation);\n\t\n\t\n\td_light += fbm(uv*size+vec2(time*time_speed, 0.0))*0.3; \n\t\n\t\n\tfloat dither_border = (1.0/pixels)*dither_size;\n\n\t\n\tvec4 col = color1;\n\tif (d_light > light_border_1) {\n\t\tcol = color2;\n\t\tif (d_light < light_border_1 + dither_border && (dith || !should_dither)) {\n\t\t\tcol = color1;\n\t\t}\n\t}\n\tif (d_light > light_border_2) {\n\t\tcol = color3;\n\t\tif (d_light < light_border_2 + dither_border && (dith || !should_dither)) {\n\t\t\tcol = color2;\n\t\t}\n\t}\n\t\n\tmaterialColor = vec4(col.rgb, a * col.a);\n}",
    "uniform float pixels;\nuniform float rotation;\nuniform vec2 light_origin;\nuniform float time_speed;\nuniform float dither_size;\nuniform float light_border_1;\nuniform float light_border_2;\nuniform float land_cutoff;\n\nuniform vec4 col1;\nuniform vec4 col2;\nuniform vec4 col3;\nuniform vec4 col4;\n\nuniform float size;\nuniform int OCTAVES;\nuniform float seed;\nuniform float time;\n\n\nfloat rand(vec2 coord) {\n\t\n\t\n\t\n\t\n\tcoord = mod(coord, vec2(2.0,1.0)*floor(size+0.5));\n\treturn fract(sin(dot(coord.xy ,vec2(12.9898,78.233))) * 15.5453 * seed);\n}\n\n\nfloat noise(vec2 coord){\n\tvec2 i = floor(coord);\n\tvec2 f = fract(coord);\n\t\t\n\tfloat a = rand(i);\n\tfloat b = rand(i + vec2(1.0, 0.0));\n\tfloat c = rand(i + vec2(0.0, 1.0));\n\tfloat d = rand(i + vec2(1.0, 1.0));\n\n\tvec2 cubic = f * f * (3.0 - 2.0 * f);\n\n\treturn mix(a, b, cubic.x) + (c - a) * cubic.y * (1.0 - cubic.x) + (d - b) * cubic.x * cubic.y;\n}\n\nfloat fbm(vec2 coord){\n\tfloat value = 0.0;\n\tfloat scale = 0.5;\n\n\tfor(int i=0;i<20;i++){if(i>=OCTAVES)break;\n\t\tvalue += noise(coord) * scale;\n\t\tcoord *= 2.0;\n\t\tscale *= 0.5;\n\t}\n\treturn value;\n}\n\nvec2 spherify(vec2 uv) {\n\tvec2 centered= uv *2.0-1.0;\n\tfloat z = sqrt(max(0.0,1.0-dot(centered.xy,centered.xy)));\n\tvec2 sphere = centered/(z + 1.0);\n\treturn sphere * 0.5+0.5;\n}\n\nvec2 rotate(vec2 coord, float angle){\n\tcoord -= 0.5;\n\tcoord *= mat2(vec2(cos(angle),-sin(angle)),vec2(sin(angle),cos(angle)));\n\treturn coord + 0.5;\n}\n\nvoid materialMain() {\n\t\n\tvec2 uv = floor(materialUv*pixels)/pixels;\n\t\n\tfloat d_light = illuminationDistance();\n\t\n\tfloat d_circle = distance(uv, vec2(0.5));\n\t\n\tfloat a = step(d_circle, 0.49999);\n\t\n\t\n\tuv = rotate(uv, rotation);\n\t\n\t\n\tuv = spherify(uv);\n\t\n\t\n\tvec2 base_fbm_uv = (uv)*size+vec2(time*time_speed,0.0);\n\t\n\t\n\tfloat fbm1 = fbm(base_fbm_uv);\n\tfloat fbm2 = fbm(base_fbm_uv - light_origin*fbm1);\n\tfloat fbm3 = fbm(base_fbm_uv - light_origin*1.5*fbm1);\n\tfloat fbm4 = fbm(base_fbm_uv - light_origin*2.0*fbm1);\n\t\n\t\n\t\n\tif (d_light < light_border_1) {\n\t\tfbm4 *= 0.9;\n\t}\n\tif (d_light > light_border_1) {\n\t\tfbm2 *= 1.05;\n\t\tfbm3 *= 1.05;\n\t\tfbm4 *= 1.05;\n\t} \n\tif (d_light > light_border_2) {\n\t\tfbm2 *= 1.3;\n\t\tfbm3 *= 1.4;\n\t\tfbm4 *= 1.8;\n\t} \n\t\n\t\n\td_light = pow(d_light, 2.0)*0.1;\n\tvec4 col = col4;\n\t\n\t\n\tif (fbm4 + d_light < fbm1) {\n\t\tcol = col3;\n\t}\n\tif (fbm3 + d_light < fbm1) {\n\t\tcol = col2;\n\t}\n\tif (fbm2 + d_light < fbm1) {\n\t\tcol = col1;\n\t}\n\t\n\tmaterialColor = vec4(col.rgb, step(land_cutoff, fbm1) * a * col.a);\n}",
    "uniform float pixels;\nuniform float rotation;\nuniform float cloud_cover;\nuniform vec2 light_origin;\nuniform float time_speed;\nuniform float stretch;\nuniform float cloud_curve;\nuniform float light_border_1;\nuniform float light_border_2;\n\nuniform vec4 base_color;\nuniform vec4 outline_color;\nuniform vec4 shadow_base_color;\nuniform vec4 shadow_outline_color;\n\nuniform float size;\nuniform int OCTAVES;\nuniform float seed;\n\nuniform float time;\n\nfloat rand(vec2 coord) {\n\tcoord = mod(coord, vec2(1.0,1.0)*floor(size+0.5));\n\treturn fract(sin(dot(coord.xy ,vec2(12.9898,78.233))) * 15.5453 * seed);\n}\n\nfloat noise(vec2 coord){\n\tvec2 i = floor(coord);\n\tvec2 f = fract(coord);\n\t\n\tfloat a = rand(i);\n\tfloat b = rand(i + vec2(1.0, 0.0));\n\tfloat c = rand(i + vec2(0.0, 1.0));\n\tfloat d = rand(i + vec2(1.0, 1.0));\n\n\tvec2 cubic = f * f * (3.0 - 2.0 * f);\n\n\treturn mix(a, b, cubic.x) + (c - a) * cubic.y * (1.0 - cubic.x) + (d - b) * cubic.x * cubic.y;\n}\n\nfloat fbm(vec2 coord){\n\tfloat value = 0.0;\n\tfloat scale = 0.5;\n\n\tfor(int i=0;i<20;i++){if(i>=OCTAVES)break;\n\t\tvalue += noise(coord) * scale;\n\t\tcoord *= 2.0;\n\t\tscale *= 0.5;\n\t}\n\treturn value;\n}\n\n\n\nfloat circleNoise(vec2 uv) {\n    float uv_y = floor(uv.y);\n    uv.x += uv_y*.31;\n    vec2 f = fract(uv);\n\tfloat h = rand(vec2(floor(uv.x),floor(uv_y)));\n    float m = (length(f-0.25-(h*0.5)));\n    float r = h*0.25;\n    return smoothstep(0.0, r, m*0.75);\n}\n\nfloat cloud_alpha(vec2 uv) {\n\tfloat c_noise = 0.0;\n\t\n\t\n\tfor (int i = 0; i < 9; i++) {\n\t\tc_noise += circleNoise((uv * size * 0.3) + (float(i+1)+10.) + (vec2(time*time_speed, 0.0)));\n\t}\n\tfloat fbm = fbm(uv*size+c_noise + vec2(time*time_speed, 0.0));\n\t\n\treturn fbm;\n}\n\nbool dither(vec2 uv_pixel, vec2 uv_real) {\n\treturn mod(uv_pixel.x+uv_real.y,2.0/pixels) <= 1.0 / pixels;\n}\n\nvec2 spherify(vec2 uv) {\n\tvec2 centered= uv *2.0-1.0;\n\tfloat z = sqrt(max(0.0,1.0-dot(centered.xy,centered.xy)));\n\tvec2 sphere = centered/(z + 1.0);\n\treturn sphere * 0.5+0.5;\n}\n\nvec2 rotate(vec2 coord, float angle){\n\tcoord -= 0.5;\n\tcoord *= mat2(vec2(cos(angle),-sin(angle)),vec2(sin(angle),cos(angle)));\n\treturn coord + 0.5;\n}\n\nvoid materialMain() {\n\t\n\tvec2 uv = floor(materialUv*pixels)/pixels;\n\t\n\t\n\tfloat d_light = illuminationDistance();\n\t\n\t\n\tfloat d_circle = distance(uv, vec2(0.5));\n\tfloat a = step(d_circle, 0.5);\n\t\n\tfloat d_to_center = distance(uv, vec2(0.5));\n\t\n\tuv = rotate(uv, rotation);\n\t\n\t\n\tuv = spherify(uv);\n\t\n\tuv.y += smoothstep(0.0, cloud_curve, abs(uv.x-0.4));\n\t\n\t\n\tfloat c = cloud_alpha(uv*vec2(1.0, stretch));\n\t\n\t\n\tvec4 col = base_color;\n\tif (c < cloud_cover + 0.03) {\n\t\tcol = outline_color;\n\t}\n\tif (d_light + c*0.2 > light_border_1) {\n\t\tcol = shadow_base_color;\n\n\t}\n\tif (d_light + c*0.2 > light_border_2) {\n\t\tcol = shadow_outline_color;\n\t}\n\t\n\tc *= step(d_to_center, 0.5);\n\tmaterialColor = vec4(col.rgb, step(cloud_cover, c) * a * col.a);\n}",
    "uniform float pixels;\nuniform float rotation;\nuniform float cloud_cover;\nuniform vec2 light_origin;\nuniform float time_speed;\nuniform float stretch;\nuniform float cloud_curve;\nuniform float light_border_1;\nuniform float light_border_2;\nuniform float bands;\nuniform bool should_dither;\n\nuniform sampler2D colorscheme;\nuniform sampler2D dark_colorscheme;\n\nuniform float size;\nuniform int OCTAVES;\nuniform float seed;\nuniform float time;\n\nfloat rand(vec2 coord) {\n\tcoord = mod(coord, vec2(2.0,1.0)*floor(size+0.5));\n\treturn fract(sin(dot(coord.xy ,vec2(12.9898,78.233))) * 15.5453 * seed);\n}\n\nfloat noise(vec2 coord){\n\tvec2 i = floor(coord);\n\tvec2 f = fract(coord);\n\t\n\tfloat a = rand(i);\n\tfloat b = rand(i + vec2(1.0, 0.0));\n\tfloat c = rand(i + vec2(0.0, 1.0));\n\tfloat d = rand(i + vec2(1.0, 1.0));\n\n\tvec2 cubic = f * f * (3.0 - 2.0 * f);\n\n\treturn mix(a, b, cubic.x) + (c - a) * cubic.y * (1.0 - cubic.x) + (d - b) * cubic.x * cubic.y;\n}\n\nfloat fbm(vec2 coord){\n\tfloat value = 0.0;\n\tfloat scale = 0.5;\n\n\tfor(int i=0;i<20;i++){if(i>=OCTAVES)break;\n\t\tvalue += noise(coord) * scale;\n\t\tcoord *= 2.0;\n\t\tscale *= 0.5;\n\t}\n\treturn value;\n}\n\n\nfloat circleNoise(vec2 uv) {\n    float uv_y = floor(uv.y);\n    uv.x += uv_y*.31;\n    vec2 f = fract(uv);\n\tfloat h = rand(vec2(floor(uv.x),floor(uv_y)));\n    float m = (length(f-0.25-(h*0.5)));\n    float r = h*0.25;\n    return smoothstep(0.0, r, m*0.75);\n}\n\nfloat turbulence(vec2 uv) {\n\tfloat c_noise = 0.0;\n\t\n\t\n\t\n\tfor (int i = 0; i < 10; i++) {\n\t\tc_noise += circleNoise((uv * size *0.3) + (float(i+1)+10.) + (vec2(time * time_speed, 0.0)));\n\t}\n\treturn c_noise;\n}\n\nbool dither(vec2 uv_pixel, vec2 uv_real) {\n\treturn mod(uv_pixel.x+uv_real.y,2.0/pixels) <= 1.0 / pixels;\n}\n\nvec2 spherify(vec2 uv) {\n\tvec2 centered= uv *2.0-1.0;\n\tfloat z = sqrt(max(0.0,1.0-dot(centered.xy,centered.xy)));\n\tvec2 sphere = centered/(z + 1.0);\n\treturn sphere * 0.5+0.5;\n}\n\nvec2 rotate(vec2 coord, float angle){\n\tcoord -= 0.5;\n\tcoord *= mat2(vec2(cos(angle),-sin(angle)),vec2(sin(angle),cos(angle)));\n\treturn coord + 0.5;\n}\n\nvoid materialMain() {\n\t\n\tvec2 uv = floor(materialUv*pixels)/pixels;\n\tfloat light_d = illuminationDistance();\n\t\n\t\n\tbool dith = dither(uv, materialUv);\n\t\n\t\n\tfloat a = step(length(uv-vec2(0.5)), 0.49999);\n\t\n\t\n\tuv = rotate(uv, rotation);\n\t\n\t\n\tuv = spherify(uv);\n\n\t\n\tfloat band = fbm(vec2(0.0, uv.y*size*bands));\n\t\n\t\n\tfloat turb = turbulence(uv);\n\n\t\n\t\n\tfloat fbm1 = fbm(uv*size);\n\tfloat fbm2 = fbm(uv*vec2(1.0, 2.0)*size+fbm1+vec2(-time*time_speed,0.0)+turb);\n\t\n\t\n\tfbm2 *= pow(band,2.0)*7.0;\n\tfloat light = fbm2 + light_d*1.8;\n\tfbm2 += pow(light_d, 1.0)-0.3;\n\tfbm2 = smoothstep(-0.2, 4.0-fbm2, light);\n\t\n\t\n\tif (dith && should_dither) {\n\t\tfbm2 *= 1.1;\n\t}\n\t\n\t\n\tfloat posterized = floor(fbm2*4.0)/2.0;\n\tvec4 col;\n\tif (fbm2 < 0.625) {\n\t\tcol = texture2D(colorscheme, vec2(posterized, uv.y));\n\t} else {\n\t\tcol = texture2D(dark_colorscheme, vec2(posterized-1.0, uv.y));\n\t}\n\t\t\n\tmaterialColor = vec4(col.rgb, a * col.a);\n}",
    "uniform float pixels;\nuniform float rotation;\nuniform vec2 light_origin;\nuniform float time_speed;\nuniform float light_border_1;\nuniform float light_border_2;\nuniform float ring_width;\nuniform float ring_perspective;\nuniform float scale_rel_to_planet;\n\nuniform sampler2D colorscheme;\nuniform sampler2D dark_colorscheme;\n\nuniform float size;\nuniform int OCTAVES;\nuniform float seed;\nuniform float time;\n\nfloat rand(vec2 coord) {\n\tcoord = mod(coord, vec2(2.0,1.0)*floor(size+0.5));\n\treturn fract(sin(dot(coord.xy ,vec2(12.9898,78.233))) * 15.5453 * seed);\n}\n\nfloat noise(vec2 coord){\n\tvec2 i = floor(coord);\n\tvec2 f = fract(coord);\n\t\n\tfloat a = rand(i);\n\tfloat b = rand(i + vec2(1.0, 0.0));\n\tfloat c = rand(i + vec2(0.0, 1.0));\n\tfloat d = rand(i + vec2(1.0, 1.0));\n\n\tvec2 cubic = f * f * (3.0 - 2.0 * f);\n\n\treturn mix(a, b, cubic.x) + (c - a) * cubic.y * (1.0 - cubic.x) + (d - b) * cubic.x * cubic.y;\n}\n\nfloat fbm(vec2 coord){\n\tfloat value = 0.0;\n\tfloat scale = 0.5;\n\n\tfor(int i=0;i<20;i++){if(i>=OCTAVES)break;\n\t\tvalue += noise(coord) * scale;\n\t\tcoord *= 2.0;\n\t\tscale *= 0.5;\n\t}\n\treturn value;\n}\n\n\nfloat circleNoise(vec2 uv) {\n    float uv_y = floor(uv.y);\n    uv.x += uv_y*.31;\n    vec2 f = fract(uv);\n\tfloat h = rand(vec2(floor(uv.x),floor(uv_y)));\n    float m = (length(f-0.25-(h*0.5)));\n    float r = h*0.25;\n    return smoothstep(0.0, r, m*0.75);\n}\n\nvec2 spherify(vec2 uv) {\n\tvec2 centered= uv *2.0-1.0;\n\tfloat z = sqrt(max(0.0,1.0-dot(centered.xy,centered.xy)));\n\tvec2 sphere = centered/(z + 1.0);\n\treturn sphere * 0.5+0.5;\n}\n\nvec2 rotate(vec2 coord, float angle){\n\tcoord -= 0.5;\n\tcoord *= mat2(vec2(cos(angle),-sin(angle)),vec2(sin(angle),cos(angle)));\n\treturn coord + 0.5;\n}\n\nvoid materialMain() {\n\t\n\tvec2 uv = floor(materialUv*pixels)/pixels;\n\t\n\tfloat light_d = illuminationDistance();\n\tuv = rotate(uv, rotation);\n\t\n\t\n\tvec2 uv_center = uv - vec2(0.0, 0.5);\n\t\n\t\n\tuv_center *= vec2(1.0, ring_perspective);\n\tfloat center_d = distance(uv_center,vec2(0.5, 0.0));\n\t\n\t\n\t\n\tfloat ring = smoothstep(0.5-ring_width*2.0, 0.5-ring_width, center_d);\n\tring *= smoothstep(center_d-ring_width, center_d, 0.4);\n\t\n\t\n\tif (uv.y < 0.5) {\n\t\tring *= step(1.0/scale_rel_to_planet, distance(uv,vec2(0.5)));\n\t}\n\t\n\t\n\tuv_center = rotate(uv_center+vec2(0, 0.5), time*time_speed);\n\t\n\tring *= fbm(uv_center*size);\n\t\n\t\n\tfloat posterized = floor((ring+pow(light_d, 2.0)*2.0)*4.0)/4.0;\n\tvec4 col;\n\tif (posterized <= 1.0) {\n\t\tcol = texture2D(colorscheme, vec2(posterized, uv.y));\n\t} else {\n\t\tcol = texture2D(dark_colorscheme, vec2(posterized-1.0, uv.y));\n\t}\n\tfloat ring_a = step(0.28, ring);\n\tmaterialColor = vec4(col.rgb, ring_a * col.a);\n}",
    "uniform float pixels;\nuniform float rotation;\nuniform vec2 light_origin;\nuniform float light_distance1;\nuniform float light_distance2;\nuniform float time_speed;\nuniform float dither_size;\nuniform sampler2D colors;\nuniform float size;\nuniform int OCTAVES;\nuniform float seed;\nuniform float time;\nuniform bool should_dither;\n\nfloat rand(vec2 coord) {\n\t\n\t\n\t\n\t\n\tcoord = mod(coord, vec2(2.0,1.0)*floor(size+0.5));\n\treturn fract(sin(dot(coord.xy ,vec2(12.9898,78.233))) * 43758.5453 * seed);\n}\n\nfloat noise(vec2 coord){\n\tvec2 i = floor(coord);\n\tvec2 f = fract(coord);\n\t\n\tfloat a = rand(i);\n\tfloat b = rand(i + vec2(1.0, 0.0));\n\tfloat c = rand(i + vec2(0.0, 1.0));\n\tfloat d = rand(i + vec2(1.0, 1.0));\n\n\tvec2 cubic = f * f * (3.0 - 2.0 * f);\n\n\treturn mix(a, b, cubic.x) + (c - a) * cubic.y * (1.0 - cubic.x) + (d - b) * cubic.x * cubic.y;\n}\n\nfloat fbm(vec2 coord){\n\tfloat value = 0.0;\n\tfloat scale = 0.5;\n\n\tfor(int i=0;i<20;i++){if(i>=OCTAVES)break;\n\t\tvalue += noise(coord) * scale;\n\t\tcoord *= 2.0;\n\t\tscale *= 0.5;\n\t}\n\treturn value;\n}\n\nbool dither(vec2 uv1, vec2 uv2) {\n\treturn mod(uv1.x+uv2.y,2.0/pixels) <= 1.0 / pixels;\n}\n\nvec2 rotate(vec2 coord, float angle){\n\tcoord -= 0.5;\n\tcoord *= mat2(vec2(cos(angle),-sin(angle)),vec2(sin(angle),cos(angle)));\n\treturn coord + 0.5;\n}\n\nvec2 spherify(vec2 uv) {\n\tvec2 centered= uv *2.0-1.0;\n\tfloat z = sqrt(max(0.0,1.0-dot(centered.xy,centered.xy)));\n\tvec2 sphere = centered/(z + 1.0);\n\treturn sphere * 0.5+0.5;\n}\n\n\nvoid materialMain() {\n\t\n\tvec2 uv = floor(materialUv*pixels)/pixels;\n\tbool dith = dither(uv, materialUv);\n\t\n\t\n\tfloat d_circle = distance(uv, vec2(0.5));\n\tfloat a = step(d_circle, 0.49999);\n\t\n\tuv = spherify(uv);\n\t\n\t\n\tfloat d_light = illuminationDistance();\n\t\n\tuv = rotate(uv, rotation);\n\t\n\t\n\tfloat f = fbm(uv*size+vec2(time*time_speed, 0.0));\n\t\n\t\n\td_light = smoothstep(-0.3, 1.2, d_light);\n\t\n\tif (d_light < light_distance1) {\n\t\td_light *= 0.9;\n\t}\n\tif (d_light < light_distance2) {\n\t\td_light *= 0.9;\n\t}\n\t\n\t\n\tfloat c = d_light*pow(f,0.8)*3.5; \n\t\n\t\n\tif (dith || !should_dither) {\n\t\tc += 0.02;\n\t\tc *= 1.05;\n\t}\n\t\n\t\n\tfloat posterize = floor(c*4.0)/4.0;\n\tvec4 col = texture2D(colors, vec2(posterize, 0.0));\n\t\n\tmaterialColor = vec4(col.rgb, a * col.a);\n}",
    "uniform float pixels;\nuniform float rotation;\nuniform vec2 light_origin;\nuniform float time_speed;\nuniform float light_border_1;\nuniform float light_border_2;\nuniform float lake_cutoff;\n\nuniform vec4 color1;\nuniform vec4 color2;\nuniform vec4 color3;\n\nuniform float size;\nuniform int OCTAVES;\nuniform float seed;\nuniform float time;\n\n\nfloat rand(vec2 coord) {\n\tcoord = mod(coord, vec2(2.0,1.0)*floor(size+0.5));\n\treturn fract(sin(dot(coord.xy ,vec2(12.9898,78.233))) * 43758.5453 * seed);\n}\n\nfloat noise(vec2 coord){\n\tvec2 i = floor(coord);\n\tvec2 f = fract(coord);\n\t\t\n\tfloat a = rand(i);\n\tfloat b = rand(i + vec2(1.0, 0.0));\n\tfloat c = rand(i + vec2(0.0, 1.0));\n\tfloat d = rand(i + vec2(1.0, 1.0));\n\n\tvec2 cubic = f * f * (3.0 - 2.0 * f);\n\n\treturn mix(a, b, cubic.x) + (c - a) * cubic.y * (1.0 - cubic.x) + (d - b) * cubic.x * cubic.y;\n}\n\nfloat fbm(vec2 coord){\n\tfloat value = 0.0;\n\tfloat scale = 0.5;\n\n\tfor(int i=0;i<20;i++){if(i>=OCTAVES)break;\n\t\tvalue += noise(coord) * scale;\n\t\tcoord *= 2.0;\n\t\tscale *= 0.5;\n\t}\n\treturn value;\n}\n\nvec2 spherify(vec2 uv) {\n\tvec2 centered= uv *2.0-1.0;\n\tfloat z = sqrt(max(0.0,1.0-dot(centered.xy,centered.xy)));\n\tvec2 sphere = centered/(z + 1.0);\n\treturn sphere * 0.5+0.5;\n}\n\nvec2 rotate(vec2 coord, float angle){\n\tcoord -= 0.5;\n\tcoord *= mat2(vec2(cos(angle),-sin(angle)),vec2(sin(angle),cos(angle)));\n\treturn coord + 0.5;\n}\n\nvoid materialMain() {\n\t\n\tvec2 uv = floor(materialUv*pixels)/pixels;\n\t\n\tfloat d_light = illuminationDistance();\n\t\n\t\n\tuv = rotate(uv, rotation);\n\n\n\tuv = spherify(uv);\n\t\n\t\n\tfloat fbm1 = fbm(uv*size+vec2(time*time_speed,0.0));\n\tfloat lake = fbm(uv*size+vec2(time*time_speed,0.0));\n\t\n\t\n\td_light = pow(d_light, 2.0)*0.4;\n\td_light -= d_light * lake;\n\n\t\n\tvec4 col = color1;\n\tif (d_light > light_border_1) {\n\t\tcol = color2;\n\t}\n\tif (d_light > light_border_2) {\n\t\tcol = color3;\n\t}\n\t\n\tfloat a = step(lake_cutoff, lake);\n\ta *= step(distance(vec2(0.5), uv), 0.5);\n\tmaterialColor = vec4(col.rgb, a * col.a);\n}",
    "uniform float pixels;\nuniform float rotation;\nuniform vec2 light_origin;\nuniform float time_speed;\nuniform float light_border_1;\nuniform float light_border_2;\nuniform float river_cutoff;\n\nuniform vec4 color1;\nuniform vec4 color2;\nuniform vec4 color3;\n\nuniform float size;\nuniform int OCTAVES;\nuniform float seed;\nuniform float time;\n\n\nfloat rand(vec2 coord) {\n\tcoord = mod(coord, vec2(2.0,1.0)*floor(size+0.5));\n\treturn fract(sin(dot(coord.xy ,vec2(12.9898,78.233))) * 15.5453 * seed);\n}\n\nfloat noise(vec2 coord){\n\tvec2 i = floor(coord);\n\tvec2 f = fract(coord);\n\t\t\n\tfloat a = rand(i);\n\tfloat b = rand(i + vec2(1.0, 0.0));\n\tfloat c = rand(i + vec2(0.0, 1.0));\n\tfloat d = rand(i + vec2(1.0, 1.0));\n\n\tvec2 cubic = f * f * (3.0 - 2.0 * f);\n\n\treturn mix(a, b, cubic.x) + (c - a) * cubic.y * (1.0 - cubic.x) + (d - b) * cubic.x * cubic.y;\n}\n\nfloat fbm(vec2 coord){\n\tfloat value = 0.0;\n\tfloat scale = 0.5;\n\n\tfor(int i=0;i<20;i++){if(i>=OCTAVES)break;\n\t\tvalue += noise(coord) * scale;\n\t\tcoord *= 2.0;\n\t\tscale *= 0.5;\n\t}\n\treturn value;\n}\n\nvec2 spherify(vec2 uv) {\n\tvec2 centered= uv *2.0-1.0;\n\tfloat z = sqrt(max(0.0,1.0-dot(centered.xy,centered.xy)));\n\tvec2 sphere = centered/(z + 1.0);\n\treturn sphere * 0.5+0.5;\n}\n\nvec2 rotate(vec2 coord, float angle){\n\tcoord -= 0.5;\n\tcoord *= mat2(vec2(cos(angle),-sin(angle)),vec2(sin(angle),cos(angle)));\n\treturn coord + 0.5;\n}\n\nvoid materialMain() {\n\t\n\tvec2 uv = floor(materialUv*pixels)/pixels;\n\t\n\tfloat d_light = illuminationDistance();\n\t\n\t\n\tfloat d_circle = distance(uv, vec2(0.5));\n\t\n\tfloat a = step(d_circle, 0.49999);\n\t\n\t\n\tuv = rotate(uv, rotation);\n\t\n\t\n\tuv = spherify(uv);\n\t\n\t\n\tfloat fbm1 = fbm(uv*size+vec2(time*time_speed,0.0));\n\tfloat river_fbm = fbm(uv + fbm1*2.5);\n\t\n\t\n\td_light = pow(d_light, 2.0)*0.4;\n\td_light -= d_light * river_fbm;\n\t\n\triver_fbm = step(river_cutoff, river_fbm);\n\t\n\t\n\tvec4 col = color1;\n\tif (d_light > light_border_1) {\n\t\tcol = color2;\n\t}\n\tif (d_light > light_border_2) {\n\t\tcol = color3;\n\t}\n\t\n\ta *= step(river_cutoff, river_fbm);\n\tmaterialColor = vec4(col.rgb, a * col.a);\n}",
    "uniform float pixels;\r\nuniform float rotation;\r\nuniform vec2 light_origin;\r\nuniform float time_speed;\r\nuniform float dither_size;\r\nuniform bool should_dither;\r\nuniform float light_border_1;\r\nuniform float light_border_2;\r\nuniform float river_cutoff;\r\n\r\nuniform vec4 col1;\r\nuniform vec4 col2;\r\nuniform vec4 col3;\r\nuniform vec4 col4;\r\nuniform vec4 river_col;\r\nuniform vec4 river_col_dark;\r\n\r\nuniform float size;\r\nuniform int OCTAVES;\r\nuniform float seed;\r\n\r\nuniform float time;\r\n\r\n\r\nfloat rand(vec2 coord) {\r\n\t\n\t\n\t\n\t\n\tcoord = mod(coord, vec2(2.0,1.0)*floor(size+0.5));\r\n\treturn fract(sin(dot(coord.xy ,vec2(12.9898,78.233))) * 15.5453 * seed);\r\n}\r\n\r\nfloat noise(vec2 coord){\r\n\tvec2 i = floor(coord);\r\n\tvec2 f = fract(coord);\r\n\t\t\r\n\tfloat a = rand(i);\r\n\tfloat b = rand(i + vec2(1.0, 0.0));\r\n\tfloat c = rand(i + vec2(0.0, 1.0));\r\n\tfloat d = rand(i + vec2(1.0, 1.0));\r\n\r\n\tvec2 cubic = f * f * (3.0 - 2.0 * f);\r\n\r\n\treturn mix(a, b, cubic.x) + (c - a) * cubic.y * (1.0 - cubic.x) + (d - b) * cubic.x * cubic.y;\r\n}\r\n\r\nfloat fbm(vec2 coord){\r\n\tfloat value = 0.0;\r\n\tfloat scale = 0.5;\r\n\r\n\tfor(int i=0;i<20;i++){if(i>=OCTAVES)break;\r\n\t\tvalue += noise(coord) * scale;\r\n\t\tcoord *= 2.0;\r\n\t\tscale *= 0.5;\r\n\t}\r\n\treturn value;\r\n}\r\n\r\nvec2 spherify(vec2 uv) {\r\n\tvec2 centered = uv *2.0-1.0;\r\n\tfloat z = sqrt(max(0.0,1.0-dot(centered.xy,centered.xy)));\r\n\n\tvec2 sphere = centered/(z + 1.0);\r\n\t\r\n\treturn sphere * 0.5+0.5;\r\n}\r\n\r\nvec2 rotate(vec2 coord, float angle){\r\n\tcoord -= 0.5;\r\n\tcoord *= mat2(vec2(cos(angle),-sin(angle)),vec2(sin(angle),cos(angle)));\r\n\treturn coord + 0.5;\r\n}\r\n\r\nbool dither(vec2 uv1, vec2 uv2) {\r\n\treturn mod(uv1.x+uv2.y,2.0/pixels) <= 1.0 / pixels;\r\n}\r\n\r\nvoid materialMain() {\r\n\t\n\tvec2 uv = floor(materialUv*pixels)/pixels;\r\n\t\r\n\tbool dith = dither(uv, materialUv);\r\n\t\n\tfloat a = step(length(uv-vec2(0.5)), 0.49999);\r\n\t\r\n\t\n\tuv = spherify(uv);\r\n\tfloat d_light = illuminationDistance();\r\n\t\r\n\t\n\tuv = rotate(uv, rotation);\r\n\t\r\n\t\n\tvec2 base_fbm_uv = (uv)*size+vec2(time*time_speed,0.0);\r\n\t\r\n\t\n\tfloat fbm1 = fbm(base_fbm_uv);\r\n\tfloat fbm2 = fbm(base_fbm_uv - light_origin*fbm1);\r\n\tfloat fbm3 = fbm(base_fbm_uv - light_origin*1.5*fbm1);\r\n\tfloat fbm4 = fbm(base_fbm_uv - light_origin*2.0*fbm1);\r\n\t\r\n\tfloat river_fbm = fbm(base_fbm_uv+fbm1*6.0);\r\n\triver_fbm = step(river_cutoff, river_fbm);\r\n\t\r\n\t\n\tfloat dither_border = (1.0/pixels)*dither_size;\r\n\t\n\t\n\tif (d_light < light_border_1) {\r\n\t\tfbm4 *= 0.9;\r\n\t}\r\n\tif (d_light > light_border_1) {\r\n\t\tfbm2 *= 1.05;\r\n\t\tfbm3 *= 1.05;\r\n\t\tfbm4 *= 1.05;\r\n\t} \r\n\tif (d_light > light_border_2) {\r\n\t\tfbm2 *= 1.3;\r\n\t\tfbm3 *= 1.4;\r\n\t\tfbm4 *= 1.8;\r\n\t\t\r\n\t\tif (d_light < light_border_2 + dither_border) {\r\n\t\t\tif (dith || !should_dither) {\r\n\t\t\t\tfbm4 *= 0.5;\r\n\t\t\t}\r\n\t\t}\r\n\t\t\r\n\t} \r\n\t\r\n\t\n\td_light = pow(d_light, 2.0)*0.4;\r\n\tvec4 col = col4;\r\n\tif (fbm4 + d_light < fbm1*1.5) {\r\n\t\tcol = col3;\r\n\t}\r\n\tif (fbm3 + d_light < fbm1*1.0) {\r\n\t\tcol = col2;\r\n\t}\r\n\tif (fbm2 + d_light < fbm1) {\r\n\t\tcol = col1;\r\n\t}\r\n\tif (river_fbm < fbm1*0.5) {\r\n\t\tcol = river_col_dark;\r\n\t\tif (fbm4 + d_light < fbm1*1.5) {\r\n\t\t\tcol = river_col;\r\n\t\t}\r\n\t}\r\n\r\n\tmaterialColor = vec4(col.rgb, a * col.a);\r\n}",
    "uniform float pixels;\nuniform vec4 color;\nuniform float time_speed;\nuniform float time;\nuniform float rotation;\n\n\nuniform float seed;\nuniform float circle_amount;\nuniform float circle_size;\n\nuniform float size;\nuniform int OCTAVES;\n\n\nfloat rand(vec2 co){\n\tco = mod(co, vec2(1.0,1.0)*floor(size+0.5));\n    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 15.5453 * seed);\n}\n\n\nvec2 rotate(vec2 vec, float angle) {\n\tvec -=vec2(0.5);\n\tvec *= mat2(vec2(cos(angle),-sin(angle)), vec2(sin(angle),cos(angle)));\n\tvec += vec2(0.5);\n\treturn vec;\n}\n\nfloat circle(vec2 uv) {\n\tfloat invert = 1.0 / circle_amount;\n\t\n\tif (mod(uv.y, invert*2.0) < invert) {\n\t\tuv.x += invert*0.5;\n\t}\n\tvec2 rand_co = floor(uv*circle_amount)/circle_amount;\n\tuv = mod(uv, invert)*circle_amount;\n\t\n\tfloat r = rand(rand_co);\n\tr = clamp(r, invert, 1.0 - invert);\n\tfloat circle = distance(uv, vec2(r));\n\treturn smoothstep(circle, circle+0.5, invert * circle_size * rand(rand_co*1.5));\n}\n\n\nfloat noise(vec2 coord){\n\tvec2 i = floor(coord);\n\tvec2 f = fract(coord);\n\t\t\n\tfloat a = rand(i);\n\tfloat b = rand(i + vec2(1.0, 0.0));\n\tfloat c = rand(i + vec2(0.0, 1.0));\n\tfloat d = rand(i + vec2(1.0, 1.0));\n\n\tvec2 cubic = f * f * (3.0 - 2.0 * f);\n\n\treturn mix(a, b, cubic.x) + (c - a) * cubic.y * (1.0 - cubic.x) + (d - b) * cubic.x * cubic.y;\n}\n\nfloat fbm(vec2 coord){\n\tfloat value = 0.0;\n\tfloat scl = 0.5;\n\n\tfor(int i=0;i<20;i++){if(i>=OCTAVES)break;\n\t\tvalue += noise(coord) * scl;\n\t\tcoord *= 2.0;\n\t\tscl *= 0.5;\n\t}\n\treturn value;\n}\n\nvec2 spherify(vec2 uv) {\n\tvec2 centered= uv *2.0-1.0;\n\tfloat z = sqrt(max(0.0,1.0-dot(centered.xy,centered.xy)));\n\tvec2 sphere = centered/(z + 1.0);\n\treturn sphere * 0.5+0.5;\n}\n\nvoid materialMain() {\n\tvec2 pixelized = floor(materialUv*pixels)/pixels;\n\n\tvec2 uv = rotate(pixelized, rotation);\n\n\t\n\tfloat angle = atan(uv.x - 0.5, uv.y - 0.5);\n\tfloat d = distance(pixelized, vec2(0.5));\n\t\n\t\n\tfloat c = 0.0;\n\tfor(int i = 0; i < 15; i++) {\n\t\tfloat r = rand(vec2(float(i)));\n\t\tvec2 circleUV = vec2(d, angle);\n\t\tc += circle(circleUV*size -time * time_speed - (1.0/d) * 0.1 + r);\n\t}\n\t\n\tc *= 0.37 - d;\n\tc = step(0.07, c - d);\n\t\n\tmaterialColor = vec4(color.rgb, c * color.a);\n}",
    "uniform float pixels;\nuniform float time_speed;\nuniform float time;\nuniform float rotation;\nuniform sampler2D colorramp;\nuniform bool should_dither;\n\nuniform float seed;\nuniform float size;\nuniform int OCTAVES;\nuniform float TILES;\n\n\nfloat rand(vec2 co) {\n\tco = mod(co, vec2(1.0,1.0)*floor(size+0.5));\n    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 15.5453 * seed);\n}\n\nvec2 rotate(vec2 vec, float angle) {\n\tvec -=vec2(0.5);\n\tvec *= mat2(vec2(cos(angle),-sin(angle)), vec2(sin(angle),cos(angle)));\n\tvec += vec2(0.5);\n\treturn vec;\n}\n\nfloat noise(vec2 coord){\n\tvec2 i = floor(coord);\n\tvec2 f = fract(coord);\n\t\t\n\tfloat a = rand(i);\n\tfloat b = rand(i + vec2(1.0, 0.0));\n\tfloat c = rand(i + vec2(0.0, 1.0));\n\tfloat d = rand(i + vec2(1.0, 1.0));\n\n\tvec2 cubic = f * f * (3.0 - 2.0 * f);\n\n\treturn mix(a, b, cubic.x) + (c - a) * cubic.y * (1.0 - cubic.x) + (d - b) * cubic.x * cubic.y;\n}\n\nvec2 Hash2(vec2 p) {\n\tfloat r = 523.0*sin(dot(p, vec2(53.3158, 43.6143)));\n\treturn vec2(fract(15.32354 * r), fract(17.25865 * r));\n\t\n}\n\n\nfloat Cells(in vec2 p, in float numCells) {\n\tp *= numCells;\n\tfloat d = 1.0e10;\n\tfor (int xo = -1; xo <= 1; xo++)\n\t{\n\t\tfor (int yo = -1; yo <= 1; yo++)\n\t\t{\n\t\t\tvec2 tp = floor(p) + vec2(float(xo), float(yo));\n\t\t\ttp = p - tp - Hash2(mod(tp, numCells / TILES));\n\t\t\td = min(d, dot(tp, tp));\n\t\t}\n\t}\n\treturn sqrt(d);\n}\n\nbool dither(vec2 uv1, vec2 uv2) {\n\treturn mod(uv1.x+uv2.y,2.0/pixels) <= 1.0 / pixels;\n}\n\nvec2 spherify(vec2 uv) {\n\tvec2 centered= uv *2.0-1.0;\n\tfloat z = sqrt(max(0.0,1.0-dot(centered.xy,centered.xy)));\n\tvec2 sphere = centered/(z + 1.0);\n\treturn sphere * 0.5+0.5;\n}\n\nvoid materialMain() {\n\t\n\tvec2 pixelized = floor(materialUv*pixels)/pixels;\n\t\n\t\n\t\n\tfloat a = step(distance(pixelized, vec2(0.5)), .49999);\n\t\n\t\n\tbool dith = dither(materialUv, pixelized);\n\t\n\tpixelized = rotate(pixelized, rotation);\n\t\n\t\n\tpixelized = spherify(pixelized);\n\t\n\t\n\tfloat n = Cells(pixelized - vec2(time * time_speed * 2.0, 0), 10.0);\n\tn *= Cells(pixelized - vec2(time * time_speed * 1.0, 0), 20.0);\n\n\t\n\t\n\tn*= 2.;\n\tn = clamp(n, 0.0, 1.0);\n\tif (dith || !should_dither) { \n\t\tn *= 1.3;\n\t}\n\t\n\t\n\tfloat interpolate = floor(n * 3.0) / 3.0;\n\tvec4 col = texture2D(colorramp, vec2(interpolate, 0.0));\n\t\n\tmaterialColor = vec4(col.rgb, a * col.a);\n}",
    "uniform float pixels;\nuniform sampler2D colorramp;\nuniform float time_speed;\nuniform float time;\nuniform float rotation;\nuniform bool should_dither;\n\nuniform float storm_width;\nuniform float storm_dither_width;\n\nuniform float scale;\nuniform float seed;\nuniform float circle_amount;\nuniform float circle_scale;\n\nuniform float size;\nuniform int OCTAVES;\n\n\nfloat rand(vec2 co){\n\tco = mod(co, vec2(1.0,1.0)*floor(size+0.5));\n    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 15.5453 * seed);\n}\n\n\nvec2 rotate(vec2 vec, float angle) {\n\tvec -=vec2(0.5);\n\tvec *= mat2(vec2(cos(angle),-sin(angle)), vec2(sin(angle),cos(angle)));\n\tvec += vec2(0.5);\n\treturn vec;\n}\n\nfloat circle(vec2 uv) {\n\tfloat invert = 1.0 / circle_amount;\n\t\n\tif (mod(uv.y, invert*2.0) < invert) {\n\t\tuv.x += invert*0.5;\n\t}\n\tvec2 rand_co = floor(uv*circle_amount)/circle_amount;\n\tuv = mod(uv, invert)*circle_amount;\n\t\n\tfloat r = rand(rand_co);\n\tr = clamp(r, invert, 1.0 - invert);\n\tfloat circle = distance(uv, vec2(r));\n\treturn smoothstep(circle, circle+0.5, invert * circle_scale * rand(rand_co*1.5));\n}\n\n\nfloat noise(vec2 coord){\n\tvec2 i = floor(coord);\n\tvec2 f = fract(coord);\n\t\t\n\tfloat a = rand(i);\n\tfloat b = rand(i + vec2(1.0, 0.0));\n\tfloat c = rand(i + vec2(0.0, 1.0));\n\tfloat d = rand(i + vec2(1.0, 1.0));\n\n\tvec2 cubic = f * f * (3.0 - 2.0 * f);\n\n\treturn mix(a, b, cubic.x) + (c - a) * cubic.y * (1.0 - cubic.x) + (d - b) * cubic.x * cubic.y;\n}\n\nfloat fbm(vec2 coord){\n\tfloat value = 0.0;\n\tfloat scl = 0.5;\n\n\tfor(int i=0;i<20;i++){if(i>=OCTAVES)break;\n\t\tvalue += noise(coord) * scl;\n\t\tcoord *= 2.0;\n\t\tscl *= 0.5;\n\t}\n\treturn value;\n}\n\nbool dither(vec2 uv1, vec2 uv2) {\n\treturn mod(uv1.x+uv2.y,2.0/pixels) <= 1.0 / pixels;\n}\n\nvec2 spherify(vec2 uv) {\n\tvec2 centered= uv *2.0-1.0;\n\tfloat z = sqrt(max(0.0,1.0-dot(centered.xy,centered.xy)));\n\tvec2 sphere = centered/(z + 1.0);\n\treturn sphere * 0.5+0.5;\n}\n\n\nvoid materialMain() {\n\t\n\tvec2 pixelized = floor(materialUv*pixels)/pixels;\n\t\n\t\n\tbool dith = dither(materialUv, pixelized);\n\t\n\tpixelized = rotate(pixelized, rotation);\n\t\n\t\n\tvec2 uv = pixelized;\n\t\n\t\n\tfloat angle = atan(uv.x - 0.5, uv.y - 0.5) * 0.4;\n\t\n\tfloat d = distance(pixelized, vec2(0.5));\n\t\n\t\n\tvec2 circleUV = vec2(d, angle);\n\t\n\t\n\tfloat n = fbm(circleUV*size -time * time_speed);\n\tfloat nc = circle(circleUV*scale -time * time_speed + n);\n\t\n\tnc *= 1.5;\n\tfloat n2 = fbm(circleUV*size -time + vec2(100, 100));\n\tnc -= n2 * 0.1;\n\t\n\t\n\tfloat a = 0.0;\n\tif (1.0 - d > nc) {\n\t\t\n\t\tif (nc > storm_width - storm_dither_width + d && (dith || !should_dither)) {\n\t\t\ta = 1.0;\n\t\t} else if (nc > storm_width + d) { \n\t\t\ta = 1.0;\n\t\t}\n\t}\n\t\n\t\n\tfloat interpolate = floor(n2 + nc);\n\tvec4 col = texture2D(colorramp, vec2(interpolate, 0.0));\n\t\n\t\n\ta *= step(n2 * 0.25, d);\n\tmaterialColor = vec4(col.rgb, a * col.a);\n}",
    "uniform float pixels;\n\nuniform sampler2D colorscheme;\nuniform vec4 black_color;\n\nuniform float radius;\nuniform float light_width;\n\n\nvoid materialMain() {\n\t\n\tvec2 uv = floor(materialUv*pixels)/pixels;\n\t\n\t\n\tfloat d_to_center = distance(uv, vec2(0.5));\n\t\n\tvec4 col = black_color;\n\t\n\tif (d_to_center > radius - light_width) {\n\t\tfloat col_val = ceil(d_to_center-(radius - (light_width * 0.5))) * (1.0/(light_width * 0.5));\n\t\tcol = texture2D(colorscheme, vec2(col_val, 0.0));\n\t}\n\t\n\tfloat a = step(d_to_center, radius);\n\t\n\tmaterialColor = vec4(col.rgb, a * col.a);\n}",
    "uniform float pixels;\nuniform float rotation;\nuniform vec2 light_origin;\nuniform float time_speed;\nuniform float disk_width;\nuniform float ring_perspective;\nuniform bool should_dither;\nuniform sampler2D colorscheme;\n\nuniform float size;\nuniform int OCTAVES;\nuniform float seed;\nuniform float time;\n\nfloat rand(vec2 coord) {\n\tcoord = mod(coord, vec2(2.0,1.0)*floor(size+0.5));\n\treturn fract(sin(dot(coord.xy ,vec2(12.9898,78.233))) * 15.5453 * seed);\n}\n\nfloat noise(vec2 coord){\n\tvec2 i = floor(coord);\n\tvec2 f = fract(coord);\n\t\n\tfloat a = rand(i);\n\tfloat b = rand(i + vec2(1.0, 0.0));\n\tfloat c = rand(i + vec2(0.0, 1.0));\n\tfloat d = rand(i + vec2(1.0, 1.0));\n\n\tvec2 cubic = f * f * (3.0 - 2.0 * f);\n\n\treturn mix(a, b, cubic.x) + (c - a) * cubic.y * (1.0 - cubic.x) + (d - b) * cubic.x * cubic.y;\n}\n\nfloat fbm(vec2 coord){\n\tfloat value = 0.0;\n\tfloat scale = 0.5;\n\n\tfor(int i=0;i<20;i++){if(i>=OCTAVES)break;\n\t\tvalue += noise(coord) * scale;\n\t\tcoord *= 2.0;\n\t\tscale *= 0.5;\n\t}\n\treturn value;\n}\n\n\nfloat circleNoise(vec2 uv) {\n    float uv_y = floor(uv.y);\n    uv.x += uv_y*.31;\n    vec2 f = fract(uv);\n\tfloat h = rand(vec2(floor(uv.x),floor(uv_y)));\n    float m = (length(f-0.25-(h*0.5)));\n    float r = h*0.25;\n    return smoothstep(0.0, r, m*0.75);\n}\n\nbool dither(vec2 uv_pixel, vec2 uv_real) {\n\treturn mod(uv_pixel.x+uv_real.y,2.0/pixels) <= 1.0 / pixels;\n}\n\nvec2 spherify(vec2 uv) {\n\tvec2 centered= uv *2.0-1.0;\n\tfloat z = sqrt(max(0.0,1.0-dot(centered.xy,centered.xy)));\n\tvec2 sphere = centered/(z + 1.0);\n\treturn sphere * 0.5+0.5;\n}\n\nvec2 rotate(vec2 coord, float angle){\n\tcoord -= 0.5;\n\tcoord *= mat2(vec2(cos(angle),-sin(angle)),vec2(sin(angle),cos(angle)));\n\treturn coord + 0.5;\n}\n\nvoid materialMain() {\n\t\n\tvec2 uv = floor(materialUv*pixels)/pixels;\n\t\n\t\n\tbool dith = dither(materialUv, uv);\n\t\n\tuv = rotate(uv, rotation);\n\t\n\t\n\tvec2 uv2 = uv;\n\t\n\t\n\tuv.x -= 0.5;\n\tuv.x *= 1.3;\n\tuv.x += 0.5;\n\t\n\t\n\tuv = rotate(uv, sin(time * time_speed * 2.0) * 0.01);\n\t\n\t\n\tvec2 l_origin = vec2(0.5);\n\t\n\tfloat d_width = disk_width;\n\t\n\t\n\tif (uv.y < 0.5) { \n\t\t\n\t\tuv.y += smoothstep(distance(vec2(0.5), uv), 0.5, 0.2);\n\t\t\n\t\td_width += smoothstep(distance(vec2(0.5), uv), 0.5, 0.3);\n\t\t\n\t\t\n\t\tl_origin.y -= smoothstep(distance(vec2(0.5), uv), 0.5, 0.2);\n\t} \n\t\n\t\n\telse if (uv.y > 0.53) {\n\n\t\t\n\t\tuv.y -= smoothstep(distance(vec2(0.5), uv), 0.4, 0.17);\n\t\td_width += smoothstep(distance(vec2(0.5), uv), 0.5, 0.2);\n\t\tl_origin.y += smoothstep(distance(vec2(0.5), uv), 0.5, 0.2);\n\t}\n\t\n\t\n\tfloat light_d = distance(uv2 * vec2(1.0, ring_perspective), l_origin * vec2(1.0, ring_perspective)) * 0.3;\n\n\t\n\tvec2 uv_center = uv - vec2(0.0, 0.5);\n\n\t\n\tuv_center *= vec2(1.0, ring_perspective);\n\tfloat center_d = distance(uv_center,vec2(0.5, 0.0));\n\t\n\t\n\t\n\tfloat disk = smoothstep(0.1-d_width*2.0, 0.5-d_width, center_d);\n\tdisk *= smoothstep(center_d-d_width, center_d, 0.4);\n\t\n\t\n\tuv_center = rotate(uv_center+vec2(0, 0.5), time*time_speed*3.0);\n\t\n\t\n\tdisk *= pow(fbm(uv_center*size), 0.5);\n\t\n\t\n\tif (dith || !should_dither) {\n\t\tdisk *= 1.2;\n\t}\n\t\n\t\n\tfloat posterized = floor((disk+light_d)*4.0)/4.0;\n\tvec4 col = texture2D(colorscheme, vec2(posterized, uv.y));\n\t\n\t\n\n\n\n\n\n\t\n\tfloat disk_a = step(0.15, disk);\n\tmaterialColor = vec4(col.rgb, disk_a * col.a);\n}"
  ],
  "presets": {
    "rocky": {
      "scene": "NoAtmosphere/NoAtmosphere",
      "span": 1,
      "layers": [
        {
          "name": "Ground",
          "shader": 0,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "rotation": 0.15,
            "light_origin": [
              0.25,
              0.25
            ],
            "time_speed": 0.4,
            "dither_size": 2,
            "light_border_1": 0.615,
            "light_border_2": 0.729,
            "color1": [
              0.705882,
              0.717647,
              0.760784,
              1
            ],
            "color2": [
              0.458824,
              0.482353,
              0.572549,
              1
            ],
            "color3": [
              0.211765,
              0.235294,
              0.337255,
              1
            ],
            "size": 8,
            "OCTAVES": 4,
            "seed": 1.27,
            "time": 6.8,
            "should_dither": false
          }
        },
        {
          "name": "Craters",
          "shader": 1,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "rotation": 0.15,
            "light_origin": [
              0.25,
              0.25
            ],
            "time_speed": 0.001,
            "light_border": 0.465,
            "color1": [
              0.458824,
              0.482353,
              0.572549,
              1
            ],
            "color2": [
              0.211765,
              0.235294,
              0.337255,
              1
            ],
            "size": 5,
            "seed": 1.27,
            "time": 1700
          }
        }
      ]
    },
    "ocean": {
      "scene": "LandMasses/LandMasses",
      "span": 1,
      "layers": [
        {
          "name": "Water",
          "shader": 2,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "rotation": 0.15,
            "light_origin": [
              0.25,
              0.25
            ],
            "time_speed": 0.1,
            "dither_size": 2,
            "light_border_1": 0.4,
            "light_border_2": 0.6,
            "color1": [
              0.478431,
              0.796078,
              0.835294,
              1
            ],
            "color2": [
              0.192157,
              0.447059,
              0.639216,
              1
            ],
            "color3": [
              0.090196,
              0.160784,
              0.27451,
              1
            ],
            "size": 5.228,
            "OCTAVES": 3,
            "seed": 5.83,
            "time": 17,
            "should_dither": false
          }
        },
        {
          "name": "Land",
          "shader": 3,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "rotation": 0.15,
            "light_origin": [
              0.25,
              0.25
            ],
            "time_speed": 0.2,
            "dither_size": 2,
            "light_border_1": 0.32,
            "light_border_2": 0.534,
            "land_cutoff": 0.633,
            "col1": [
              0.643137,
              0.788235,
              0.607843,
              1
            ],
            "col2": [
              0.435294,
              0.6,
              0.501961,
              1
            ],
            "col3": [
              0.231373,
              0.411765,
              0.392157,
              1
            ],
            "col4": [
              0.101961,
              0.207843,
              0.258824,
              1
            ],
            "size": 4.292,
            "OCTAVES": 6,
            "seed": 5.83,
            "time": 6.8
          }
        },
        {
          "name": "Cloud",
          "shader": 4,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "rotation": 0.15,
            "cloud_cover": 0.533662,
            "light_origin": [
              0.25,
              0.25
            ],
            "time_speed": 0.47,
            "stretch": 2,
            "cloud_curve": 1.3,
            "light_border_1": 0.52,
            "light_border_2": 0.62,
            "base_color": [
              0.909804,
              0.929412,
              0.941176,
              1
            ],
            "outline_color": [
              0.741176,
              0.803922,
              0.862745,
              1
            ],
            "shadow_base_color": [
              0.388235,
              0.494118,
              0.611765,
              1
            ],
            "shadow_outline_color": [
              0.215686,
              0.282353,
              0.380392,
              1
            ],
            "size": 7.745,
            "OCTAVES": 2,
            "seed": 5.83,
            "time": 5.787234
          }
        }
      ]
    },
    "gas": {
      "scene": "GasPlanetLayers/GasPlanetLayers",
      "span": 3,
      "layers": [
        {
          "name": "GasLayers",
          "shader": 5,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "rotation": 0.15,
            "cloud_cover": 0.61,
            "light_origin": [
              0.25,
              0.25
            ],
            "time_speed": 0.05,
            "stretch": 2.204,
            "cloud_curve": 1.376,
            "light_border_1": 0.52,
            "light_border_2": 0.62,
            "bands": 0.892,
            "should_dither": false,
            "colorscheme": {
              "colors": [
                [
                  0.929412,
                  0.8,
                  0.607843,
                  1
                ],
                [
                  0.756863,
                  0.552941,
                  0.509804,
                  1
                ],
                [
                  0.47451,
                  0.403922,
                  0.509804,
                  1
                ]
              ],
              "offsets": [
                0,
                0.498182,
                1
              ]
            },
            "dark_colorscheme": {
              "colors": [
                [
                  0.521569,
                  0.396078,
                  0.470588,
                  1
                ],
                [
                  0.317647,
                  0.262745,
                  0.372549,
                  1
                ],
                [
                  0.160784,
                  0.172549,
                  0.278431,
                  1
                ]
              ],
              "offsets": [
                0,
                0.5,
                1
              ]
            },
            "size": 10.107,
            "OCTAVES": 3,
            "seed": 8.46,
            "time": 68
          }
        },
        {
          "name": "Ring",
          "shader": 6,
          "scale": 3,
          "params": {
            "pixels": 3072,
            "rotation": 0.85,
            "light_origin": [
              0.25,
              0.25
            ],
            "time_speed": 0.2,
            "light_border_1": 0.52,
            "light_border_2": 0.62,
            "ring_width": 0.127,
            "ring_perspective": 6,
            "scale_rel_to_planet": 6,
            "colorscheme": {
              "colors": [
                [
                  0.929412,
                  0.8,
                  0.607843,
                  1
                ],
                [
                  0.756863,
                  0.552941,
                  0.509804,
                  1
                ],
                [
                  0.47451,
                  0.403922,
                  0.509804,
                  1
                ]
              ],
              "offsets": [
                0,
                0.498182,
                1
              ]
            },
            "dark_colorscheme": {
              "colors": [
                [
                  0.521569,
                  0.396078,
                  0.470588,
                  1
                ],
                [
                  0.317647,
                  0.262745,
                  0.372549,
                  1
                ],
                [
                  0.160784,
                  0.172549,
                  0.278431,
                  1
                ]
              ],
              "offsets": [
                0,
                0.5,
                1
              ]
            },
            "size": 15,
            "OCTAVES": 4,
            "seed": 8.46,
            "time": 5.34055
          }
        }
      ]
    },
    "desert": {
      "scene": "DryTerran/DryTerran",
      "span": 1,
      "layers": [
        {
          "name": "Land",
          "shader": 7,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "rotation": 0.15,
            "light_origin": [
              0.25,
              0.25
            ],
            "light_distance1": 0.362,
            "light_distance2": 0.525,
            "time_speed": 0.1,
            "dither_size": 2,
            "colors": {
              "colors": [
                [
                  1,
                  0.537255,
                  0.2,
                  1
                ],
                [
                  0.901961,
                  0.270588,
                  0.223529,
                  1
                ],
                [
                  0.678431,
                  0.184314,
                  0.270588,
                  1
                ],
                [
                  0.321569,
                  0.2,
                  0.247059,
                  1
                ],
                [
                  0.239216,
                  0.160784,
                  0.211765,
                  1
                ]
              ],
              "offsets": [
                0,
                0.25,
                0.5,
                0.75,
                1
              ]
            },
            "size": 8,
            "OCTAVES": 3,
            "seed": 3.91,
            "time": 27.2,
            "should_dither": false
          }
        }
      ]
    },
    "ice": {
      "scene": "IceWorld/IceWorld",
      "span": 1,
      "layers": [
        {
          "name": "Land",
          "shader": 2,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "rotation": 0.15,
            "light_origin": [
              0.25,
              0.25
            ],
            "time_speed": 0.25,
            "dither_size": 2,
            "light_border_1": 0.48,
            "light_border_2": 0.632,
            "color1": [
              0.933333,
              0.960784,
              0.980392,
              1
            ],
            "color2": [
              0.67451,
              0.807843,
              0.878431,
              1
            ],
            "color3": [
              0.337255,
              0.45098,
              0.552941,
              1
            ],
            "size": 8,
            "OCTAVES": 2,
            "seed": 2.19,
            "time": 10.88,
            "should_dither": false
          }
        },
        {
          "name": "Lakes",
          "shader": 8,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "rotation": 0.15,
            "light_origin": [
              0.25,
              0.25
            ],
            "time_speed": 0.2,
            "light_border_1": 0.024,
            "light_border_2": 0.047,
            "lake_cutoff": 0.55,
            "color1": [
              0.454902,
              0.745098,
              0.839216,
              1
            ],
            "color2": [
              0.235294,
              0.482353,
              0.607843,
              1
            ],
            "color3": [
              0.105882,
              0.215686,
              0.321569,
              1
            ],
            "size": 10,
            "OCTAVES": 3,
            "seed": 2.19,
            "time": 17
          }
        },
        {
          "name": "Clouds",
          "shader": 4,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "rotation": 0.15,
            "cloud_cover": 0.546,
            "light_origin": [
              0.25,
              0.25
            ],
            "time_speed": 0.1,
            "stretch": 2.5,
            "cloud_curve": 1.3,
            "light_border_1": 0.566,
            "light_border_2": 0.781,
            "base_color": [
              0.945098,
              0.960784,
              0.980392,
              1
            ],
            "outline_color": [
              0.788235,
              0.862745,
              0.913725,
              1
            ],
            "shadow_base_color": [
              0.407843,
              0.529412,
              0.619608,
              1
            ],
            "shadow_outline_color": [
              0.227451,
              0.32549,
              0.435294,
              1
            ],
            "size": 4,
            "OCTAVES": 4,
            "seed": 2.19,
            "time": 13.6
          }
        }
      ]
    },
    "lava": {
      "scene": "LavaWorld/LavaWorld",
      "span": 1,
      "layers": [
        {
          "name": "Land",
          "shader": 0,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "rotation": 0.15,
            "light_origin": [
              0.25,
              0.25
            ],
            "time_speed": 0.2,
            "dither_size": 2,
            "light_border_1": 0.4,
            "light_border_2": 0.6,
            "color1": [
              0.439216,
              0.356863,
              0.396078,
              1
            ],
            "color2": [
              0.243137,
              0.207843,
              0.294118,
              1
            ],
            "color3": [
              0.137255,
              0.117647,
              0.203922,
              1
            ],
            "size": 10,
            "OCTAVES": 3,
            "seed": 6.72,
            "time": 17,
            "should_dither": false
          }
        },
        {
          "name": "Craters",
          "shader": 1,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "rotation": 0.15,
            "light_origin": [
              0.25,
              0.25
            ],
            "time_speed": 0.2,
            "light_border": 0.4,
            "color1": [
              0.243137,
              0.207843,
              0.294118,
              1
            ],
            "color2": [
              0.137255,
              0.117647,
              0.203922,
              1
            ],
            "size": 3.5,
            "seed": 6.72,
            "time": 6.8
          }
        },
        {
          "name": "LavaRivers",
          "shader": 9,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "rotation": 0.15,
            "light_origin": [
              0.25,
              0.25
            ],
            "time_speed": 0.2,
            "light_border_1": 0.019,
            "light_border_2": 0.036,
            "river_cutoff": 0.579,
            "color1": [
              1,
              0.737255,
              0.403922,
              1
            ],
            "color2": [
              0.956863,
              0.411765,
              0.27451,
              1
            ],
            "color3": [
              0.65098,
              0.215686,
              0.25098,
              1
            ],
            "size": 10,
            "OCTAVES": 4,
            "seed": 6.72,
            "time": 17
          }
        }
      ]
    },
    "temperate": {
      "scene": "Rivers/Rivers",
      "span": 1,
      "layers": [
        {
          "name": "Land",
          "shader": 10,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "rotation": 0.15,
            "light_origin": [
              0.25,
              0.25
            ],
            "time_speed": 0.1,
            "dither_size": 3.951,
            "should_dither": false,
            "light_border_1": 0.287,
            "light_border_2": 0.476,
            "river_cutoff": 0.368,
            "col1": [
              0.607843,
              0.733333,
              0.501961,
              1
            ],
            "col2": [
              0.388235,
              0.533333,
              0.415686,
              1
            ],
            "col3": [
              0.239216,
              0.376471,
              0.345098,
              1
            ],
            "col4": [
              0.129412,
              0.231373,
              0.258824,
              1
            ],
            "river_col": [
              0.54902,
              0.721569,
              0.803922,
              1
            ],
            "river_col_dark": [
              0.243137,
              0.458824,
              0.588235,
              1
            ],
            "size": 4.6,
            "OCTAVES": 6,
            "seed": 3.28,
            "time": 17
          }
        },
        {
          "name": "Cloud",
          "shader": 4,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "rotation": 0.15,
            "cloud_cover": 0.420529,
            "light_origin": [
              0.25,
              0.25
            ],
            "time_speed": 0.1,
            "stretch": 2,
            "cloud_curve": 1.3,
            "light_border_1": 0.52,
            "light_border_2": 0.62,
            "base_color": [
              0.933333,
              0.945098,
              0.894118,
              1
            ],
            "outline_color": [
              0.737255,
              0.788235,
              0.737255,
              1
            ],
            "shadow_base_color": [
              0.478431,
              0.588235,
              0.54902,
              1
            ],
            "shadow_outline_color": [
              0.298039,
              0.384314,
              0.411765,
              1
            ],
            "size": 7.315,
            "OCTAVES": 2,
            "seed": 3.28,
            "time": 11.9
          }
        }
      ]
    },
    "star-yellow": {
      "scene": "Star/Star",
      "span": 2,
      "layers": [
        {
          "name": "Blobs",
          "shader": 11,
          "scale": 2,
          "params": {
            "pixels": 2048,
            "color": [
              1,
              0.956863,
              0.74902,
              1
            ],
            "time_speed": 0.05,
            "time": 34,
            "rotation": 0.15,
            "seed": 4.2,
            "circle_amount": 2,
            "circle_size": 1,
            "size": 4.93,
            "OCTAVES": 4
          }
        },
        {
          "name": "Star",
          "shader": 12,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "time_speed": 0.05,
            "time": 3.4,
            "rotation": 0.15,
            "colorramp": {
              "colors": [
                [
                  1,
                  0.956863,
                  0.74902,
                  1
                ],
                [
                  1,
                  0.823529,
                  0.431373,
                  1
                ],
                [
                  0.94902,
                  0.580392,
                  0.32549,
                  1
                ],
                [
                  0.611765,
                  0.282353,
                  0.266667,
                  1
                ]
              ],
              "offsets": [
                0,
                0.33,
                0.66,
                1
              ]
            },
            "should_dither": false,
            "seed": 4.2,
            "size": 4.463,
            "OCTAVES": 4,
            "TILES": 1
          }
        },
        {
          "name": "StarFlares",
          "shader": 13,
          "scale": 2,
          "params": {
            "pixels": 2048,
            "colorramp": {
              "colors": [
                [
                  1,
                  0.823529,
                  0.431373,
                  1
                ],
                [
                  1,
                  0.956863,
                  0.74902,
                  1
                ]
              ],
              "offsets": [
                0,
                1
              ]
            },
            "time_speed": 0.05,
            "time": 13.6,
            "rotation": 0.15,
            "should_dither": false,
            "storm_width": 0.3,
            "storm_dither_width": 0,
            "scale": 1,
            "seed": 4.2,
            "circle_amount": 2,
            "circle_scale": 1,
            "size": 1.6,
            "OCTAVES": 4
          }
        }
      ]
    },
    "star-red": {
      "scene": "Star/Star",
      "span": 2,
      "layers": [
        {
          "name": "Blobs",
          "shader": 11,
          "scale": 2,
          "params": {
            "pixels": 2048,
            "color": [
              1,
              0.85098,
              0.698039,
              1
            ],
            "time_speed": 0.05,
            "time": 34,
            "rotation": 0.15,
            "seed": 5.21,
            "circle_amount": 2,
            "circle_size": 1,
            "size": 4.93,
            "OCTAVES": 4
          }
        },
        {
          "name": "Star",
          "shader": 12,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "time_speed": 0.05,
            "time": 3.4,
            "rotation": 0.15,
            "colorramp": {
              "colors": [
                [
                  1,
                  0.894118,
                  0.780392,
                  1
                ],
                [
                  0.984314,
                  0.627451,
                  0.443137,
                  1
                ],
                [
                  0.862745,
                  0.396078,
                  0.341176,
                  1
                ],
                [
                  0.513726,
                  0.184314,
                  0.266667,
                  1
                ]
              ],
              "offsets": [
                0,
                0.33,
                0.66,
                1
              ]
            },
            "should_dither": false,
            "seed": 5.21,
            "size": 4.463,
            "OCTAVES": 4,
            "TILES": 1
          }
        },
        {
          "name": "StarFlares",
          "shader": 13,
          "scale": 2,
          "params": {
            "pixels": 2048,
            "colorramp": {
              "colors": [
                [
                  0.984314,
                  0.627451,
                  0.443137,
                  1
                ],
                [
                  1,
                  0.894118,
                  0.780392,
                  1
                ]
              ],
              "offsets": [
                0,
                1
              ]
            },
            "time_speed": 0.05,
            "time": 13.6,
            "rotation": 0.15,
            "should_dither": false,
            "storm_width": 0.3,
            "storm_dither_width": 0,
            "scale": 1,
            "seed": 5.21,
            "circle_amount": 2,
            "circle_scale": 1,
            "size": 1.6,
            "OCTAVES": 4
          }
        }
      ]
    },
    "star-blue": {
      "scene": "Star/Star",
      "span": 2,
      "layers": [
        {
          "name": "Blobs",
          "shader": 11,
          "scale": 2,
          "params": {
            "pixels": 2048,
            "color": [
              0.870588,
              0.937255,
              1,
              1
            ],
            "time_speed": 0.05,
            "time": 34,
            "rotation": 0.15,
            "seed": 6.23,
            "circle_amount": 2,
            "circle_size": 1,
            "size": 4.93,
            "OCTAVES": 4
          }
        },
        {
          "name": "Star",
          "shader": 12,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "time_speed": 0.05,
            "time": 3.4,
            "rotation": 0.15,
            "colorramp": {
              "colors": [
                [
                  0.94902,
                  0.968627,
                  1,
                  1
                ],
                [
                  0.631373,
                  0.827451,
                  0.929412,
                  1
                ],
                [
                  0.352941,
                  0.568627,
                  0.772549,
                  1
                ],
                [
                  0.207843,
                  0.356863,
                  0.580392,
                  1
                ]
              ],
              "offsets": [
                0,
                0.33,
                0.66,
                1
              ]
            },
            "should_dither": false,
            "seed": 6.23,
            "size": 4.463,
            "OCTAVES": 4,
            "TILES": 1
          }
        },
        {
          "name": "StarFlares",
          "shader": 13,
          "scale": 2,
          "params": {
            "pixels": 2048,
            "colorramp": {
              "colors": [
                [
                  0.631373,
                  0.827451,
                  0.929412,
                  1
                ],
                [
                  0.94902,
                  0.968627,
                  1,
                  1
                ]
              ],
              "offsets": [
                0,
                1
              ]
            },
            "time_speed": 0.05,
            "time": 13.6,
            "rotation": 0.15,
            "should_dither": false,
            "storm_width": 0.3,
            "storm_dither_width": 0,
            "scale": 1,
            "seed": 6.23,
            "circle_amount": 2,
            "circle_scale": 1,
            "size": 1.6,
            "OCTAVES": 4
          }
        }
      ]
    },
    "star-white": {
      "scene": "Star/Star",
      "span": 2,
      "layers": [
        {
          "name": "Blobs",
          "shader": 11,
          "scale": 2,
          "params": {
            "pixels": 2048,
            "color": [
              0.952941,
              0.952941,
              0.92549,
              1
            ],
            "time_speed": 0.05,
            "time": 34,
            "rotation": 0.15,
            "seed": 7.29,
            "circle_amount": 2,
            "circle_size": 1,
            "size": 4.93,
            "OCTAVES": 4
          }
        },
        {
          "name": "Star",
          "shader": 12,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "time_speed": 0.05,
            "time": 3.4,
            "rotation": 0.15,
            "colorramp": {
              "colors": [
                [
                  1,
                  1,
                  1,
                  1
                ],
                [
                  0.894118,
                  0.909804,
                  0.886275,
                  1
                ],
                [
                  0.619608,
                  0.67451,
                  0.784314,
                  1
                ],
                [
                  0.337255,
                  0.427451,
                  0.572549,
                  1
                ]
              ],
              "offsets": [
                0,
                0.33,
                0.66,
                1
              ]
            },
            "should_dither": false,
            "seed": 7.29,
            "size": 4.463,
            "OCTAVES": 4,
            "TILES": 1
          }
        },
        {
          "name": "StarFlares",
          "shader": 13,
          "scale": 2,
          "params": {
            "pixels": 2048,
            "colorramp": {
              "colors": [
                [
                  0.894118,
                  0.909804,
                  0.886275,
                  1
                ],
                [
                  1,
                  1,
                  1,
                  1
                ]
              ],
              "offsets": [
                0,
                1
              ]
            },
            "time_speed": 0.05,
            "time": 13.6,
            "rotation": 0.15,
            "should_dither": false,
            "storm_width": 0.3,
            "storm_dither_width": 0,
            "scale": 1,
            "seed": 7.29,
            "circle_amount": 2,
            "circle_scale": 1,
            "size": 1.6,
            "OCTAVES": 4
          }
        }
      ]
    },
    "black-hole": {
      "scene": "BlackHole/BlackHole",
      "span": 2,
      "layers": [
        {
          "name": "BlackHole",
          "shader": 14,
          "scale": 1,
          "params": {
            "pixels": 1024,
            "colorscheme": {
              "colors": [
                [
                  1,
                  1,
                  0.921569,
                  1
                ],
                [
                  0.929412,
                  0.482353,
                  0.223529,
                  1
                ]
              ],
              "offsets": [
                0,
                1
              ]
            },
            "black_color": [
              0.152941,
              0.152941,
              0.211765,
              1
            ],
            "radius": 0.247,
            "light_width": 0.028
          }
        },
        {
          "name": "Disk",
          "shader": 15,
          "scale": 3,
          "params": {
            "pixels": 3072,
            "rotation": 0.85,
            "light_origin": [
              0.607,
              0.444
            ],
            "time_speed": 0.2,
            "disk_width": 0.065,
            "ring_perspective": 14,
            "should_dither": false,
            "colorscheme": {
              "colors": [
                [
                  1,
                  1,
                  0.921569,
                  1
                ],
                [
                  1,
                  0.960784,
                  0.25098,
                  1
                ],
                [
                  1,
                  0.721569,
                  0.290196,
                  1
                ],
                [
                  0.929412,
                  0.482353,
                  0.223529,
                  1
                ],
                [
                  0.741176,
                  0.25098,
                  0.207843,
                  1
                ]
              ],
              "offsets": [
                0,
                0.25,
                0.5,
                0.75,
                1
              ]
            },
            "size": 6.598,
            "OCTAVES": 3,
            "seed": 9.15,
            "time": 5.34055
          }
        }
      ]
    }
  }
}
