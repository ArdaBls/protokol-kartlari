// Sahte (mock) SortableJS - sadece duman testi amaçlı, sürükle-bırak davranışını simüle etmez.
(function () {
	function Sortable(el, options) {
		this.el = el;
		this.options = options || {};
	}
	Sortable.prototype.destroy = function () {};
	Sortable.create = function (el, options) { return new Sortable(el, options); };
	window.Sortable = Sortable;
})();
