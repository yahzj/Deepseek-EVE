# 导出本机原程序的完整材质参数，供离线生成WebGL移植数据。
# Godot3.5/游戏v0.1.0/档v31，2026-10-10。
extends SceneTree

func _init():
	call_deferred("export_materials")

func encode(value):
	if value is GradientTexture:
		var colors = []
		for color in value.gradient.colors:
			colors.append([color.r, color.g, color.b, color.a])
		return {"colors": colors, "offsets": Array(value.gradient.offsets)}
	if value is Color:
		return [value.r, value.g, value.b, value.a]
	if value is Vector2:
		return [value.x, value.y]
	return value

func export_materials():
	var file = File.new()
	if file.open(OS.get_environment("WHALE_MATERIAL_INPUT"), File.READ) != OK:
		quit(1)
		return
	var definitions = JSON.parse(file.get_as_text()).result
	file.close()
	var presets = {}
	var shaders = []
	for definition in definitions:
		var planet = load("res://Planets/" + definition.scene + ".tscn").instance()
		var viewport = Viewport.new()
		viewport.size = Vector2(128, 128)
		viewport.transparent_bg = true
		viewport.usage = Viewport.USAGE_2D
		viewport.render_target_update_mode = Viewport.UPDATE_ALWAYS
		get_root().add_child(viewport)
		viewport.add_child(planet)
		planet.override_time = true
		planet.set_pixels(1024)
		seed(int(definition.seed))
		planet.set_seed(int(definition.seed))
		planet.set_light(Vector2(0.25, 0.25))
		planet.set_rotate(0.15)
		planet.set_dither(false)
		var colors = []
		for hex in definition.colors:
			colors.append(Color(hex))
		planet.set_colors(colors)
		planet.set_custom_time(0.17)
		for _frame in range(3):
			yield(self, "idle_frame")
		VisualServer.force_draw()
		yield(VisualServer, "frame_post_draw")
		var layers = []
		for layer in planet.get_children():
			if not layer is ColorRect:
				continue
			var material = layer.material
			var code = material.shader.code
			var index = shaders.find(code)
			if index < 0:
				index = shaders.size()
				shaders.append(code)
			var params = {}
			var uniforms = RegEx.new()
			uniforms.compile("uniform\\s+\\w+\\s+(\\w+)")
			for parameter in uniforms.search_all(code):
				var name = parameter.get_string(1)
				params[name] = encode(material.get_shader_param(name))
			layers.append({"name": layer.name, "shader": index, "scale": layer.rect_size.x / 1024.0, "params": params})
		presets[definition.id] = {"scene": definition.scene, "span": planet.relative_scale, "layers": layers}
		viewport.queue_free()
		yield(self, "idle_frame")
	if file.open(OS.get_environment("WHALE_MATERIAL_OUTPUT"), File.WRITE) != OK:
		quit(1)
		return
	file.store_string(JSON.print({"shaders": shaders, "presets": presets}, "  "))
	file.close()
	print("Exported original shader materials: " + str(shaders.size()))
	quit(0)
