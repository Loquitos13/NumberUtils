import java.lang.reflect.Array;
import java.util.*;

public class NumberUtils {
    public static double calcularMedia(List<Double> numeros) {
        double soma = 0;
        for (Double num : numeros) {
            soma += num;
        }
        return soma / numeros.size();
    }

    public static double calcularMediana(List<Double> numeros) {
        List<Double> listaOrdenada = new ArrayList<>(numeros);
        Collections.sort(listaOrdenada);
        int numeroMeio = listaOrdenada.size() / 2;
        if (listaOrdenada.size() % 2 == 0) {
            return (listaOrdenada.get(numeroMeio - 1) + listaOrdenada.get(numeroMeio)) / 2;
        } else {
            return listaOrdenada.get(numeroMeio);
        }
    }

    public static List<Double> calcularModa(List<Double> numeros) {
        Map<Double, Integer> frequenciaNumero = new HashMap<>();
        for (Double num : numeros) {
            frequenciaNumero.put(num, frequenciaNumero.getOrDefault(num, 0) + 1);
        }
        int freqMaxima = Collections.max(frequenciaNumero.values());
        List<Double> moda = new ArrayList<>();
        for (Map.Entry<Double, Integer> entry : frequenciaNumero.entrySet()) {
            if (entry.getValue() == freqMaxima) {
                moda.add(entry.getKey());
            }
        }
        return moda;
    }

    public static void ordenarLista(List<Double> numeros, boolean crescente) {
        if (crescente) {
            Collections.sort(numeros);
        } else {
            Collections.sort(numeros, Collections.reverseOrder());
        }
    }
}
